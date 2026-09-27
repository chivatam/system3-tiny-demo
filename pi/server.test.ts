import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { get, type Server } from "node:http";
import test from "node:test";
import { createObservatoryServer } from "./server.ts";
import type { RunRecord } from "./observatory-types.ts";

test(
  "local API streams real workers, persists replay, isolates memory, and cancels safely",
  { timeout: 30_000 },
  async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "system3-ui-"));
    let server: Server;
    const start = async () => {
      server = createObservatoryServer({ directory, offlineIntervalMs: 100 });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    };
    const close = () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      });
    let url = await start();
    t.after(async () => {
      await close();
      rmSync(directory, { recursive: true, force: true });
    });
    const input = {
      mode: "offline",
      scenario: "learn",
      memory: "persistent",
      destination: "research",
    };
    const post = (body: unknown, path = "/api/runs", headers = {}) =>
      fetch(url + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    const finished = async (id: string) => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const run = (await (
          await fetch(`${url}/api/runs/${id}`)
        ).json()) as RunRecord;
        if (run.status !== "running") return run;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("Worker did not settle");
    };
    assert.equal(
      (await post(input, "/api/runs", { Origin: "https://untrusted.example" }))
        .status,
      403,
    );
    const invalidHostStatus = await new Promise<number | undefined>(
      (resolve, reject) => {
        get(
          url + "/api/config",
          { headers: { Host: "untrusted.example" } },
          (res) => {
            res.resume();
            resolve(res.statusCode);
          },
        ).on("error", reject);
      },
    );
    assert.equal(invalidHostStatus, 403);
    assert.equal((await post({ ...input, state: "/tmp/escape" })).status, 400);
    assert.equal(
      (await post({ ...input, destination: "../escape" })).status,
      400,
    );
    assert.deepEqual(
      Object.keys(await (await fetch(url + "/api/config")).json()).sort(),
      ["activeRunId", "fireworksAvailable"],
    );
    const competing = await Promise.all([post(input), post(input)]);
    assert.deepEqual(competing.map((r) => r.status).sort(), [201, 409]);
    const first = (await competing
      .find((r) => r.status === 201)!
      .json()) as RunRecord;
    const stream = await fetch(`${url}/api/runs/${first.id}/events`);
    assert.match(stream.headers.get("content-type")!, /text\/event-stream/);
    const reader = stream.body!.getReader();
    assert.match(
      new TextDecoder().decode((await reader.read()).value),
      /event: snapshot/,
    );
    await reader.cancel();
    const cold = await finished(first.id);
    assert.equal(cold.summary?.success, true);
    assert.notEqual(cold.summary?.pid, process.pid);
    assert.ok(cold.events.some((e) => e.event === "code_changed"));
    const repeat = (await (
      await post({ ...input, scenario: "recall" })
    ).json()) as RunRecord;
    const warm = await finished(repeat.id);
    assert.equal(warm.summary?.success, true);
    assert.notEqual(warm.summary?.pid, cold.summary?.pid);
    assert.ok(warm.events.find((e) => e.event === "memory_loaded")?.lesson);
    assert.ok(warm.summary!.toolCalls < cold.summary!.toolCalls);
    const fresh = (await (
      await post({ ...input, scenario: "recall", memory: "fresh" })
    ).json()) as RunRecord;
    const isolated = await finished(fresh.id);
    assert.equal(
      isolated.events.find((e) => e.event === "memory_loaded")?.lesson,
      null,
    );
    const cancelled = (await (await post(input)).json()) as RunRecord;
    assert.equal(
      (await post({}, `/api/runs/${cancelled.id}/cancel`)).status,
      202,
    );
    const stopped = await finished(cancelled.id);
    assert.equal(stopped.status, "stopped");
    assert.equal(stopped.summary?.reason, "cancelled");
    assert.ok(
      !stopped.events.some((e) => e.event === "memory_saved" && e.promoted),
    );
    await close();
    url = await start();
    assert.equal(
      (await (await fetch(url + "/api/runs")).json())[0].id,
      cancelled.id,
    );
    const replay = await fetch(`${url}/api/runs/${cold.id}/events`);
    assert.match(await replay.text(), /"event":"code_changed"/);
    const exported = await fetch(`${url}/api/runs/${cold.id}/export`);
    assert.match(exported.headers.get("content-disposition")!, /attachment/);
    assert.deepEqual((await exported.json()).events, cold.events);
  },
);
