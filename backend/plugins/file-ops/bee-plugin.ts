import type { z } from "zod";

export interface BeeContext {
  getDataDir(): string;
  getModel(): string;
  requestApproval(
    title: string,
    description: string,
    details?: Record<string, string>,
  ): Promise<boolean>;
  reportStep(label: string): void;
}

export type SelectionCaseKind = "positive" | "negative" | "ambiguous";

export interface SelectionTestCase<S extends z.ZodType = z.ZodType> {
  query: string;
  kind: SelectionCaseKind;
  shouldInvoke?: boolean;
  expectedParams?: Partial<z.infer<S>>;
}

export type ExecutionTestKind = "happy" | "edge" | "error";

export interface ExecutionTestCase<S extends z.ZodType = z.ZodType> {
  description: string;
  kind: ExecutionTestKind;
  params: z.infer<S>;
  expect: (output: string) => boolean;
}

export interface BeePlugin<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  selectionTests: SelectionTestCase<S>[];
  executionTests: ExecutionTestCase<S>[];
  initialize(context: BeeContext): void | Promise<void>;
  process(
    input: z.infer<S>,
    options?: { signal?: AbortSignal },
  ): string | Promise<string>;
  dispose?(): void | Promise<void>;
}
