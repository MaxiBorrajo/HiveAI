import type { z } from "zod";

export interface BeeContext {
  getDataDir(): string;
  getTestDir(): string;
  getModel(): string;
}

export type SelectionCaseKind = "positive" | "negative" | "ambiguous";

export interface SelectionTestCase {
  query: string;
  kind: SelectionCaseKind;
  shouldInvoke?: boolean;
}

export type ExecutionTestKind = "happy" | "edge" | "error";

export interface ExecutionTestCase<S extends z.ZodObject<any, any>> {
  description: string;
  kind: ExecutionTestKind;
  params: z.infer<S>;
  expect: (output: string) => boolean;
}

export interface BeePlugin<
  S extends z.ZodObject<any, any> = z.ZodObject<any, any>,
> {
  name: string;
  description: string;
  schema: S;
  selectionTests?: SelectionTestCase[];
  executionTests?: ExecutionTestCase<S>[];
  initialize(context: BeeContext): void | Promise<void>;
  process(input: z.infer<S>): string | Promise<string>;
  dispose?(): void | Promise<void>;
}
