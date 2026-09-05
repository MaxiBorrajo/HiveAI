import type { z } from "zod";

export interface BeeContext {
  getDataDir(): string;
  getModel(): string;
  // Blocks until a human approves or rejects, or the request times out
  // (treated as a rejection). Use this for anything a plugin does that a
  // human should sign off on first — the plugin never talks to the HTTP
  // layer or the frontend directly, and doesn't need to know how approvals
  // are actually surfaced to the user.
  requestApproval(
    title: string,
    description: string,
    details?: Record<string, string>,
  ): Promise<boolean>;
  // Records a sub-step of the plugin's own work (e.g. "trying provider X"),
  // shown alongside the graph's own step log. Fire-and-forget — no-op
  // outside of an active tool invocation.
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
  process(input: z.infer<S>): string | Promise<string>;
  dispose?(): void | Promise<void>;
}
