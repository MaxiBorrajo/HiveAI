// What a run keeps about itself, stored with its result when it finishes. The
// models are frozen as already resolved (never "Default model") and the key
// alias as it was, so later edits to the graph or the keys do not rewrite it.
export interface RunModel {
  provider: string;
  model: string;
  location: "local" | "cloud";
  keyId: string | null;
  keyAlias: string | null;
}

export interface RunNodeSnapshot {
  id: string;
  name: string;
  type: string;
  model: RunModel | null;
}

export interface RunOrchestrator extends RunModel {
  // "generation": the model that generated the graph. "current": the graph
  // predates that being recorded, so the chat's model at run time was assumed.
  source: "generation" | "current";
}

export interface RunInfo {
  startedAt: number;
  endedAt: number;
  // Wall clock from the start of the run to its end, not the sum of its calls.
  durationMs: number;
  orchestrator: RunOrchestrator | null;
  nodes: RunNodeSnapshot[];
  // What the run was started with. Absent for runs saved before it was kept.
  input?: Record<string, unknown> | null;
}
