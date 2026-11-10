import type { RunUsage } from "@/lib/usage";
export type DataType = "string" | "number" | "boolean" | "object" | "array" | "enum" | "unknown";
export type ReducerStrategy = "overwrite" | "append" | "prepend" | "unique_append" | "merge_dict" | "sum" | "subtract" | "multiply" | "divide";

export interface StatePropertyDefinition {
  type: DataType;
  description?: string;
  required: boolean;
  default?: any;
  properties?: Record<string, StatePropertyDefinition>;
  items?: StatePropertyDefinition;
  options?: string[];
  reducerStrategy?: ReducerStrategy;
}

export type NodeType = "start" | "end" | "llm" | "plugin" | "condition";

export type PaletteNodeType = "start" | "end" | "llm" | "agent" | "plugin" | "condition";

export interface GraphViolation {
  kind: string;
  nodeId: string;
  nodeName: string;
  edgeId?: string;
  field: string;
  invalidValue: string;
  reason: string;
}

export interface GraphNode {
  id: string;
  name: string;
  type: NodeType;
  uiPosition?: { x: number; y: number };
  config: Record<string, any>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  path?: "true" | "false";
  isConditional: boolean;
  condition?: {
    field: string;
    operator: string;
    value: unknown;
  };
}

export interface LangGraphAbstraction {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stateSchema: Record<string, StatePropertyDefinition>;
}

export interface Execution {
  id: number;
  name: string;
  lastResultId: number | null;
  lastGraphId: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ExecutionSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface ExecutionDetails {
  execution: any;
  graph?: {
    id: number;
    graph: LangGraphAbstraction;
    state: any;
    createdAt: number;
  };
  lastResult?: {
    id: number;
    executionId: number;
    iteration: number;
    result: any;
    finalState?: Record<string, any>;
    createdAt: number;
  } | null;
}

export type ExecutionResultType =
  | "file"
  | "markdown"
  | "text"
  | "table"
  | "chart"
  | "json"
  | "image"
  | "html"
  | "url"
  | "terminal"
  | "boolean"
  | "error";

export interface ExecutionFileArtifact {
  name: string;
  path: string;
  size?: number;
  mimeType?: string;
}

export interface ExecutionResult {
  type: ExecutionResultType;
  summary: string;
  content: any;
  files?: ExecutionFileArtifact[];
  metadata?: Record<string, any>;
}

export interface ExecutionResultData {
  result: any;
  finalState?: Record<string, any>;
  iteration?: number;
  historyId?: number;
  createdAt?: number;
}
export interface RunSummary {
  historyId: number;
  iteration: number;
  createdAt: number;
  graphId: number;
  result: unknown;
  input: Record<string, unknown> | null;
  usage: RunUsage | null;
  grades: RunGrade[];
  trigger: "manual" | "scheduled";
}

export interface Rubric {
  id: number;
  version: number;
  rubric: string;
  reference: string | null;
  createdAt: number;
}

export interface RunGrade {
  historyId: number;
  status: "graded" | "failed";
  score: number | null;
  reasoning: string | null;
  error: string | null;
  judge: {
    provider: string;
    model: string;
    keyId: string | null;
    version: number;
  };
  rubric: { id: number; version: number };
  createdAt: number;
}

export interface JudgeChoice {
  provider: string;
  model: string;
  keyId: string;
}

export type ScheduleFrequency = "daily" | "weekly" | "cron";

export type ScheduleRunStatus =
  | "running"
  | "ok"
  | "failed"
  | "missed"
  | "skipped";

export interface Schedule {
  id: number;
  executionId: number;
  frequency: ScheduleFrequency;
  /** Local "HH:MM". */
  timeOfDay: string;
  /** 0 (Sunday) - 6 (Saturday); only used by weekly schedules. */
  daysOfWeek: number[];
  /** 5-field cron expression; only used when frequency is "cron". */
  cron: string;
  /** Fixed input handed to every run. */
  input: string;
  enabled: boolean;
  nextRunAt: number;
  lastRunAt: number | null;
}

export interface ScheduleRun {
  id: number;
  scheduleId: number;
  executionId: number;
  scheduledFor: number;
  status: ScheduleRunStatus;
  historyId: number | null;
  missedCount: number;
  error: string | null;
  acknowledged: boolean;
  startedAt: number;
  finishedAt: number | null;
}

export interface SchedulesPayload {
  schedules: Schedule[];
  runs: ScheduleRun[];
  /** The graph insists on an input, so a schedule must carry a fixed one. */
  inputRequired: boolean;
}

export interface ScheduleDraft {
  frequency: ScheduleFrequency;
  timeOfDay: string;
  daysOfWeek: number[];
  cron: string;
  input: string;
}

export interface BackgroundSettings {
  launchAtLogin: boolean;
  runInBackground: boolean;
}
