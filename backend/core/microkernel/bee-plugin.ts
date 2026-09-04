import type { z } from "zod";

export interface BeeContext {
  getDataDir(): string;
  getModel(): string;
}

export type SelectionCaseKind = "positive" | "negative" | "ambiguous";

export interface SelectionTestCase<
  S extends z.ZodObject<any, any> = z.ZodObject<any, any>,
> {
  query: string;
  kind: SelectionCaseKind;
  shouldInvoke?: boolean;
  expectedParams?: Partial<z.infer<S>>;
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
  selectionTests: SelectionTestCase<S>[];
  executionTests: ExecutionTestCase<S>[];
  initialize(context: BeeContext): void | Promise<void>;
  process(input: z.infer<S>): string | Promise<string>;
  dispose?(): void | Promise<void>;
}
