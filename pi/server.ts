import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SCENARIOS,
  type RunInput,
  type RunRecord,
  type RunSummary,
} from "./observatory-types.ts";

const repository = fileURLToPath(new URL("..", import.meta.url));
const workerPath = fileURLToPath(new URL("./ui-worker.ts", import.meta.url));
const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(body));
};
export function validateInput(value: unknown): RunInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a run configuration");
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).sort().join(",") !==
      "destination,memory,mode,scenario" ||
    !["offline", "live"].includes(String(input.mode)) ||
    !["persistent", "fresh"].includes(String(input.memory)) ||
    !SCENARIOS.some((s) => s.id === input.scenario) ||
    typeof input.destination !== "string" ||
    !/^[\w -]{1,80}$/.test(input.destination)
  )
    throw new Error("Invalid run configuration");
  if (input.scenario === "guardian" && input.mode !== "offline")
    throw new Error("The guardian probe uses the scripted planner");
  return input as RunInput;
}
async function readBody(req: IncomingMessage) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new Error("Expected application/json");
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 4096) throw new Error("Request is too large");
  }
  return JSON.parse(body);
}

export function createObservatoryServer({
  directory = join(repository, ".system3-pi/observatory"),
  staticDir = join(repository, "dist"),
  offlineIntervalMs = 650,
} = {}) {
  const records = new Map<string, RunRecord>();
  const subscribers = new Map<string, Set<ServerResponse>>();
  let active:
    { id: string; child: ChildProcess; timer: NodeJS.Timeout } | undefined;
  mkdirSync(join(directory, "records"), { recursive: true, mode: 0o700 });
  const stateIndex = join(directory, "journeys.json");
  const journeys: Partial<Record<RunInput["mode"], string>> = existsSync(
    stateIndex,
  )
    ? JSON.parse(readFileSync(stateIndex, "utf8"))
    : {};
  const persist = (record: RunRecord) => {
    const file = join(directory, "records", `${record.id}.json`);
    writeFileSync(file + ".tmp", JSON.stringify(record), { mode: 0o600 });
    renameSync(file + ".tmp", file);
  };
  for (const name of readdirSync(join(directory, "records")).filter((f) =>
    f.endsWith(".json"),
  )) {
    const record = JSON.parse(
      readFileSync(join(directory, "records", name), "utf8"),
    ) as RunRecord;
    if (record.status === "running") {
      record.status = "error";
      record.error = "The local server stopped before this run settled.";
      persist(record);
    }
    records.set(record.id, record);
  }
  const send = (id: string, name: string, data: unknown) => {
    for (const res of subscribers.get(id) ?? [])
      res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const finish = (record: RunRecord) => {
    if (active?.id === record.id) {
      clearTimeout(active.timer);
      active = undefined;
    }
    persist(record);
    send(record.id, "complete", record);
    for (const res of subscribers.get(record.id) ?? []) res.end();
    subscribers.delete(record.id);
  };
  const server = createServer(async (req, res) => {
    try {
      // Loopback binding, Host validation, and same-origin JSON mutations prevent remote pages from starting paid runs.
      const host = req.headers.host ?? "";
      if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host))
        return json(res, 403, { error: "Local requests only" });
      if (req.headers.origin && new URL(req.headers.origin).host !== host)
        return json(res, 403, {
          error: "Cross-origin requests are not allowed",
        });
      const url = new URL(req.url ?? "/", `http://${host}`);
      const path = url.pathname;
      if (path === "/api/config" && req.method === "GET")
        return json(res, 200, {
          fireworksAvailable: !!process.env.FIREWORKS_API_KEY?.trim(),
          activeRunId: active?.id ?? null,
        });
      if (path === "/api/runs" && req.method === "GET")
        return json(
          res,
          200,
          [...records.values()]
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map(({ events, ...record }) => ({
              ...record,
              eventCount: events.length,
            })),
        );
      if (path === "/api/runs" && req.method === "POST") {
        if (active)
          return json(res, 409, {
            error:
              "One run is already active. Finish or stop it before starting another.",
            activeRunId: active.id,
          });
        const input = validateInput(await readBody(req));
        if (input.mode === "live" && !process.env.FIREWORKS_API_KEY?.trim())
          return json(res, 422, {
            error:
              "Add FIREWORKS_API_KEY to the repository-root .env file and restart the local server.",
          });
        // There is an await above; recheck the single-writer lock after reading the body.
        const concurrent = active as { id: string } | undefined;
        if (concurrent)
          return json(res, 409, {
            error: "Another run has just started",
            activeRunId: concurrent.id,
          });
        const id = randomUUID();
        if (
          input.memory === "persistent" &&
          (input.scenario === "learn" || !journeys[input.mode])
        ) {
          journeys[input.mode] = randomUUID();
          writeFileSync(stateIndex, JSON.stringify(journeys), { mode: 0o600 });
        }
        const state = join(
          directory,
          "memory",
          `${input.memory === "fresh" ? id : journeys[input.mode]}.json`,
        );
        const record: RunRecord = {
          id,
          input,
          createdAt: new Date().toISOString(),
          status: "running",
          events: [],
        };
        records.set(id, record);
        persist(record);
        const child = fork(workerPath, [], {
          cwd: repository,
          stdio: ["ignore", "ignore", "ignore", "ipc"],
          execArgv: [],
          env: {
            PATH: process.env.PATH,
            FIREWORKS_API_KEY: process.env.FIREWORKS_API_KEY ?? "",
          },
        });
        const timer = setTimeout(() => {
          record.status = "error";
          record.error = "Worker exceeded its hard deadline.";
          child.kill("SIGKILL");
          finish(record);
        }, 135_000);
        active = { id, child, timer };
        child.on(
          "message",
          (message: {
            type: string;
            event?: RunRecord["events"][number];
            report?: RunSummary;
            error?: string;
          }) => {
            if (record.status !== "running") return;
            if (message.type === "trace" && message.event) {
              record.events.push(message.event);
              persist(record);
              send(id, "trace", message.event);
            } else if (message.type === "complete" && message.report) {
              const r = message.report;
              record.summary = {
                success: r.success,
                reason: r.reason,
                modelCalls: r.modelCalls,
                toolCalls: r.toolCalls,
                toolRequests: r.toolRequests,
                repairs: r.repairs,
                blocked: r.blocked,
                hostChecks: r.hostChecks,
                testFailures: r.testFailures,
                elapsedMs: r.elapsedMs,
                pid: r.pid,
                forbiddenHandlerCalls: r.forbiddenHandlerCalls,
                usage: r.usage,
              };
              record.status = r.success ? "completed" : "stopped";
              finish(record);
            } else if (message.type === "failed") {
              record.status = "error";
              record.error = message.error;
              finish(record);
            }
          },
        );
        child.on("error", () => {
          if (record.status === "running") {
            record.status = "error";
            record.error = "Could not start the Pi worker";
            finish(record);
          }
        });
        child.on("exit", () => {
          if (record.status === "running") {
            record.status = "error";
            record.error = "Pi worker exited before returning a settled result";
            finish(record);
          }
        });
        child.send({
          type: "start",
          options: {
            state,
            output: join(directory, "artifacts"),
            field: SCENARIOS.find((s) => s.id === input.scenario)!.field,
            destination: input.destination,
            offline: input.mode === "offline",
            mode: input.scenario === "guardian" ? "forbidden" : "normal",
            paceOffline: true,
            limits: {
              requestIntervalMs:
                input.mode === "offline" ? offlineIntervalMs : 6500,
            },
          },
        });
        return json(res, 201, record);
      }
      const match = path.match(
        /^\/api\/runs\/([a-f\d-]{36})(?:\/(events|cancel|export))?$/,
      );
      if (match) {
        const record = records.get(match[1]);
        if (!record) return json(res, 404, { error: "Run not found" });
        if (req.method === "POST" && match[2] === "cancel") {
          await readBody(req);
          if (active?.id === record.id) active.child.send({ type: "cancel" });
          return json(res, 202, { stopping: record.status === "running" });
        }
        if (req.method === "GET" && match[2] === "events") {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          });
          res.write(`event: snapshot\ndata: ${JSON.stringify(record)}\n\n`);
          if (record.status !== "running") return res.end();
          const clients =
            subscribers.get(record.id) ?? new Set<ServerResponse>();
          clients.add(res);
          subscribers.set(record.id, clients);
          const heartbeat = setInterval(
            () => res.write(": heartbeat\n\n"),
            15_000,
          );
          req.on("close", () => {
            clearInterval(heartbeat);
            clients.delete(res);
            if (!clients.size) subscribers.delete(record.id);
          });
          return;
        }
        if (req.method === "GET" && (!match[2] || match[2] === "export")) {
          if (match[2] === "export")
            res.setHeader(
              "Content-Disposition",
              `attachment; filename="system3-${record.id}.json"`,
            );
          return json(res, 200, record);
        }
      }
      if (path.startsWith("/api/"))
        return json(res, 404, { error: "Unknown API route" });
      if (req.method !== "GET" && req.method !== "HEAD")
        return json(res, 405, { error: "Method not allowed" });
      const root = resolve(staticDir);
      const file = resolve(
        root,
        "." + decodeURIComponent(path === "/" ? "/index.html" : path),
      );
      if (!file.startsWith(root + sep))
        return json(res, 403, { error: "Invalid asset path" });
      if (!existsSync(file))
        return json(res, 404, {
          error: "UI asset not found. Run npm run build before npm run ui.",
        });
      const mime: Record<string, string> = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
      };
      res.writeHead(200, {
        "Content-Type": mime[extname(file)] ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": path.startsWith("/assets/")
          ? "public, max-age=31536000, immutable"
          : "no-cache",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        "Referrer-Policy": "no-referrer",
      });
      res.end(req.method === "HEAD" ? undefined : readFileSync(file));
    } catch (error) {
      if (!res.headersSent)
        json(res, 400, {
          error:
            error instanceof SyntaxError
              ? "Invalid JSON"
              : error instanceof Error &&
                  /Invalid run|Expected|too large|scripted planner/.test(
                    error.message,
                  )
                ? error.message
                : "Request could not be completed",
        });
      else res.end();
    }
  });
  server.on("close", () => {
    if (active) {
      clearTimeout(active.timer);
      active.child.kill("SIGKILL");
    }
    for (const clients of subscribers.values())
      for (const res of clients) res.end();
  });
  return server;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (existsSync(join(repository, ".env")))
    process.loadEnvFile(join(repository, ".env"));
  const port = Number(process.env.PORT ?? 4317);
  const server = createObservatoryServer({
    directory: process.env.SYSTEM3_UI_DATA ?? undefined,
  });
  server.listen(port, "127.0.0.1", () =>
    console.log(`System 3 Observatory: http://127.0.0.1:${port}`),
  );
  const stop = () => {
    server.closeAllConnections();
    server.close();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
