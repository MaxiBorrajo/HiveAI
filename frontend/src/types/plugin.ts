export type SelectionCaseKind = "positive" | "negative" | "ambiguous";

export interface SelectionTestCase {
  query: string;
  kind: SelectionCaseKind;
  shouldInvoke?: boolean;
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
