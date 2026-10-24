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
  source: "generation" | "current";
}

export interface RunInfo {
  startedAt: number;
  endedAt: number;
  durationMs: number;
  orchestrator: RunOrchestrator | null;
  nodes: RunNodeSnapshot[];
  input?: Record<string, unknown> | null;
}
