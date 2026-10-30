import type { TestSuiteQualityReport } from "../../microkernel/plugin-quality-validator.ts";

export type ZodFieldType =
  | "string"
  | "number"
  | "boolean"
  | "enum"
  | "array"
  | "object";

export interface ZodFieldSpec {
  name: string;
  zodType: ZodFieldType;
  description: string;
  optional?: boolean;
  enumValues?: string[];
  /** Only for zodType "array": the element type, reusing this same shape. */
  items?: ZodFieldSpec;
}

export interface PluginSignatureDraft {
  name: string;
  description: string;
  returnDescription?: string;
  schemaFields: ZodFieldSpec[];
  /** Deterministically generated from schemaFields by code-serializer.ts. */
  schemaSourceCode: string;
  /** User-editable escape hatch for schemas the field DSL cannot express. */
  rawZodOverride?: string;
}

export interface PluginConfigFieldDraft {
  key: string;
  label: string;
  secret?: boolean;
}

export interface PluginProcessDraft {
  /** Body of `async process(input, options) { ... }`, as TS source text. */
  processSourceCode: string;
  /** Extra top-level imports the process body needs (npm:/https: specifiers). */
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
  /** Body of `(output: string) => ...`, as TS source text. */
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

export interface DraftValidationReport {
  valid: boolean;
  compileError?: string;
  qualityReport?: TestSuiteQualityReport;
  issues: string[];
}

export type IncrementalPluginEvent =
  | { type: "planning"; thoughts: string }
  | { type: "signature_drafted"; signature: PluginSignatureDraft }
  | { type: "process_drafted"; process: PluginProcessDraft }
  | { type: "tests_drafted"; tests: PluginTestsDraft }
  | { type: "validating" }
  | { type: "validation_error"; attempt: number; issues: string[] }
  | {
    type: "draft_ready";
    draft: PluginDraft;
    sourceCode: string;
    qualityReport?: TestSuiteQualityReport;
  };
