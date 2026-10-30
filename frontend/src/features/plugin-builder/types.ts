export type ZodFieldType = "string" | "number" | "boolean" | "enum" | "array" | "object";

export interface ZodFieldSpec {
  name: string;
  zodType: ZodFieldType;
  description: string;
  optional?: boolean;
  enumValues?: string[];
  items?: ZodFieldSpec;
}

export interface PluginSignatureDraft {
  name: string;
  description: string;
  returnDescription?: string;
  schemaFields: ZodFieldSpec[];
  schemaSourceCode: string;
  rawZodOverride?: string;
}

export interface PluginConfigFieldDraft {
  key: string;
  label: string;
  secret?: boolean;
}

export interface PluginProcessDraft {
  processSourceCode: string;
  importsSourceCode?: string;
  configFields?: PluginConfigFieldDraft[];
}

export interface PluginSelectionTestDraft {
  query: string;
  kind: "positive" | "negative" | "ambiguous";
  shouldInvoke?: boolean;
  expectedParams?: Record<string, unknown>;
}

export interface PluginExecutionTestDraft {
  description: string;
  kind: "happy" | "edge" | "error";
  params: Record<string, unknown>;
  expectSourceCode: string;
}

export interface PluginTestsDraft {
  selectionTests: PluginSelectionTestDraft[];
  executionTests: PluginExecutionTestDraft[];
}

export interface PluginDraft {
  signature: PluginSignatureDraft;
  process: PluginProcessDraft;
  tests: PluginTestsDraft;
}

export interface TestSuiteQualityReport {
  valid: boolean;
  total: number;
  counts: Record<string, number>;
  issues: string[];
}

export interface DraftTestResult {
  success: boolean;
  output?: string;
  error?: string;
}
