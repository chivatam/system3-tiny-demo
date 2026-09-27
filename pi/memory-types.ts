export type VerifiedField = "collection" | "workspace";
export type Evidence = {
  cases: number;
  field: VerifiedField;
  destination: string;
  sentinelPreserved: true;
};
export type Procedure = {
  contextKey: "notes-create/v1";
  field: VerifiedField;
  evidence: Evidence;
};
export type Episode = {
  taskId: string;
  outcome: "passed" | "failed" | "blocked" | "budget";
  testFailures: number;
  toolCalls: number;
};
export type Memory = {
  version: 1;
  preference: { destination: string };
  capability: {
    status: "unknown" | "needs_repair" | "verified";
    evidence?: Evidence;
  };
  procedure?: Procedure;
  episodes: Episode[];
};
