import type { TraceEvent } from "../../pi/observatory-types.ts";
import type { Memory } from "../../pi/memory-types.ts";

export const pretty = (value: unknown) => JSON.stringify(value, null, 2) ?? "—";
export const words = (value: unknown) =>
  typeof value === "string" ? value : "";
export function describe(event: TraceEvent) {
  const labels: Record<string, [string, string, string]> = {
    run_started: [
      "Task environment ready",
      "Environment",
      "A new disposable fixture and a fresh Pi process were created. The function starts with the outdated folder field.",
    ],
    memory_loaded: [
      event.lesson
        ? "A verified lesson was retrieved"
        : "No verified lesson yet",
      "Memory",
      event.lesson
        ? "This fact came from a previous verified run. It will be supplied to Pi, but the new code must pass independent checks."
        : "This run has no eligible procedure to reuse. Pi must discover a working solution.",
    ],
    goal: [
      event.selected === "diagnose_contract"
        ? "Diagnose before retrying"
        : "Pursue the authorized task",
      "Supervisor",
      words(event.reason),
    ],
    context_prepared: [
      "Context supplied to Pi",
      "Pi runtime",
      "These are the actual task instructions and retrieved lesson sent into this session.",
    ],
    model_wait: [
      "Waiting before the next request",
      "Pi runtime",
      words(event.reason),
    ],
    model_request: [
      `Model request ${event.number}`,
      "Pi runtime",
      "Pi requested the next action from its configured model. This counts against the request budget.",
    ],
    model_response: [
      "Model response received",
      "Pi runtime",
      `The response ended with ${words(event.stopReason)}. Token counts are reported usage, not a measure of understanding.`,
    ],
    assistant_message: [
      "The agent responded",
      "Agent",
      "This is the actual assistant text emitted by the configured model.",
    ],
    tool_requested: [
      `Requested ${words(event.tool)}`,
      "Agent",
      "The agent proposed this tool and these arguments. A request does not mean the action was allowed or executed.",
    ],
    guardian: [
      event.allowed
        ? `Allowed ${words(event.tool)}`
        : `Blocked ${words(event.tool)}`,
      "Guardian",
      words(event.reason),
    ],
    observation: [
      `Result from ${words(event.tool)}`,
      "Tool",
      event.isError
        ? "Pi received an error or blocked-action result. The error is part of the next model context."
        : "This is the actual tool result returned to Pi.",
    ],
    code_changed: [
      "The solution was edited",
      "Tool",
      "The write handler changed this file. Compare the exact contents before and after execution.",
    ],
    verification: [
      event.ok ? "Independent checks passed" : "Independent checks failed",
      "Verifier",
      event.ok
        ? "The host compared the returned payloads with four expected results and checked the protected sentinel."
        : words(event.error),
    ],
    memory_invalidated: [
      "The old lesson was invalidated",
      "Memory",
      words(event.reason),
    ],
    capability_changed: [
      "A capability gap was recorded",
      "Supervisor",
      "A failed check changed the observed capability to needs_repair. This is evidence from execution, not a model self-rating.",
    ],
    memory_saved: [
      event.promoted
        ? "A verified lesson was saved"
        : "Outcome saved without a new lesson",
      "Memory",
      words(event.reason),
    ],
    settled: [
      "Pi has settled",
      "Pi runtime",
      "The accepted run has no queued continuation. The supervisor can now decide whether to promote the verified result.",
    ],
    stop: [
      "The supervisor stopped execution",
      "Supervisor",
      `Stop reason: ${words(event.reason)}. New actions are no longer authorized.`,
    ],
    run_finished: [
      event.success ? "Task completed and verified" : "Run stopped",
      "Supervisor",
      event.success
        ? "The run settled, independent verification passed, and the resulting memory was saved."
        : `The task did not earn a successful outcome. Reason: ${words(event.reason)}.`,
    ],
  };
  const [title, actor, explanation] = labels[event.event] ?? [
    event.event,
    "Runtime",
    "Recorded runtime event.",
  ];
  const tone =
    (event.event === "guardian" && !event.allowed) ||
    event.event === "stop" ||
    event.event === "memory_invalidated"
      ? "amber"
      : event.event === "verification"
        ? event.ok
          ? "green"
          : "red"
        : event.event === "memory_saved" ||
            (event.event === "run_finished" && event.success)
          ? "green"
          : "neutral";
  return { title, actor, explanation, tone };
}
export function stateAt(events: TraceEvent[]) {
  let memory: Memory | undefined,
    code = "",
    goal = "complete_task";
  for (const event of events) {
    if (event.event === "run_started") code = words(event.source);
    if (event.event === "code_changed") code = words(event.after);
    if (event.event === "goal") goal = words(event.selected);
    if (event.event === "memory_loaded")
      memory = structuredClone(event.memory) as Memory;
    if (event.event === "memory_saved")
      memory = structuredClone(event.after) as Memory;
    if (event.event === "memory_invalidated" && memory) delete memory.procedure;
    if (event.event === "capability_changed" && memory)
      memory.capability = event.capability as Memory["capability"];
    if (event.event === "memory_loaded" && memory)
      memory.preference.destination = words(event.destination);
  }
  return {
    memory,
    code,
    goal,
    modelCalls: events.filter((e) => e.event === "model_request").length,
    toolCalls: events.filter((e) => e.event === "guardian" && e.allowed).length,
  };
}
