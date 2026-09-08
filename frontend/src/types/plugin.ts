export type SelectionCaseKind = "positive" | "negative" | "ambiguous";

export interface SelectionTestCase {
  query: string;
  kind: SelectionCaseKind;
  shouldInvoke?: boolean;
  expectedParams?: Record<string, unknown>;
}

export type ExecutionTestKind = "happy" | "edge" | "error";

export interface ExecutionTestCase {
  description: string;
  kind: ExecutionTestKind;
  params: Record<string, unknown>;
}

export interface Plugin {
  id: string;
  name: string;
  description: string;
  active: boolean;
  selectionTests?: SelectionTestCase[];
  executionTests?: ExecutionTestCase[];
}

export interface PluginSelectionTestItem extends SelectionTestCase {
  type: "selection";
  originalIndex: number;
  label: string;
  id: string;
  pluginName: string;
}

export interface PluginExecutionTestItem extends ExecutionTestCase {
  type: "execution";
  originalIndex: number;
  label: string;
  id: string;
  pluginName: string;
}

export type PluginTestItem = PluginSelectionTestItem | PluginExecutionTestItem;

export type TestStatus = "idle" | "running" | "success" | "error";

export interface TestResultDetails {
  selectedTool?: string | null;
  extractedParams?: Record<string, unknown> | null;
  output?: string | null;
}

export interface TestResultMetrics {
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  tokensPerSecond?: number;
}

export interface TestResult {
  status: TestStatus;
  errors?: string[];
  failureCategory?: string | null;
  details?: TestResultDetails | null;
  metrics?: TestResultMetrics | null;
}
