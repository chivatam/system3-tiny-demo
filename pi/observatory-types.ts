export type EventKind =
  | "run_started"
  | "memory_loaded"
  | "goal"
  | "context_prepared"
  | "model_wait"
  | "model_request"
  | "model_response"
  | "assistant_message"
  | "tool_requested"
  | "guardian"
  | "observation"
  | "code_changed"
  | "verification"
  | "memory_invalidated"
  | "capability_changed"
  | "memory_saved"
  | "settled"
  | "stop"
  | "run_finished";
/** Versioned wire envelope; event details are JSON data, never executable markup. */
export type TraceEvent = {
  version: 1;
  seq: number;
  event: EventKind;
  ms: number;
  [key: string]: unknown;
};
export const SCENARIOS = [
  {
    id: "learn",
    name: "First repair",
    description:
      "Watch a broken payload become working code. Keeping memory starts a new learning journey.",
    field: "collection",
  },
  {
    id: "recall",
    name: "Reuse a lesson",
    description:
      "Start a fresh Pi process and supply the last verified lesson. The code must still pass its tests.",
    field: "collection",
  },
  {
    id: "drift",
    name: "Contract drift",
    description:
      "The API now expects workspace. Watch what happens to a stored collection lesson.",
    field: "workspace",
  },
  {
    id: "preference",
    name: "New preference",
    description:
      "Keep the API contract and change the destination to shipping. Observe what is reused.",
    field: "workspace",
  },
  {
    id: "guardian",
    name: "Test the guardian",
    description:
      "The scripted planner requests a forbidden deletion. Inspect the block before any handler executes.",
    field: "workspace",
  },
] as const;
export type RunInput = {
  mode: "offline" | "live";
  scenario: (typeof SCENARIOS)[number]["id"];
  memory: "persistent" | "fresh";
  destination: string;
};
export type RunSummary = {
  success: boolean;
  reason: string;
  modelCalls: number;
  toolCalls: number;
  toolRequests: number;
  repairs: number;
  blocked: number;
  hostChecks: number;
  testFailures: number;
  elapsedMs: number;
  pid: number;
  forbiddenHandlerCalls: number;
  usage: { totalTokens: number; estimatedCostUSD: number } | null;
};
export type RunRecord = {
  id: string;
  createdAt: string;
  input: RunInput;
  status: "running" | "completed" | "stopped" | "error";
  events: TraceEvent[];
  summary?: RunSummary;
  error?: string;
};
export type RunListItem = Omit<RunRecord, "events"> & { eventCount: number };
export type ObservatoryConfig = {
  fireworksAvailable: boolean;
  activeRunId: string | null;
};
