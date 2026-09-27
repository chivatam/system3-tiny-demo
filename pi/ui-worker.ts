import { runTask, type RunOptions } from "./supervisor.ts";

const controller = new AbortController();
let started = false;
process.on(
  "message",
  async (message: { type: string; options?: RunOptions }) => {
    if (message.type === "cancel") {
      controller.abort();
      return;
    }
    if (message.type !== "start" || started || !message.options) return;
    started = true;
    try {
      const report = await runTask({
        ...message.options,
        signal: controller.signal,
        onEvent: (event) => process.send?.({ type: "trace", event }),
      });
      process.send?.({ type: "complete", report }, () => process.disconnect());
    } catch {
      process.send?.(
        {
          type: "failed",
          error:
            "The run could not complete. Check the local memory file and provider configuration.",
        },
        () => process.disconnect(),
      );
    }
  },
);
process.on("disconnect", () => {
  controller.abort();
});
