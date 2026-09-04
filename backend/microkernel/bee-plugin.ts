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
  // shown alongside the Selector/Executor/HiveQueen steps in the chat UI's
  // step log. Fire-and-forget — no-op outside of an active tool invocation.
  reportStep(label: string): void;
}

export interface BeePlugin {
  name: string;
  description: string;
  schema: z.ZodObject;
  initialize(context: BeeContext): void | Promise<void>;
  process(input: unknown): string | Promise<string>;
  dispose?(): void | Promise<void>;
}