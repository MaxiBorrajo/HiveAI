import type { z } from "zod";

export interface BeeContext {
  getDataDir(): string;
  getModel(): string;
}

export interface BeePlugin {
  name: string;
  description: string;
  schema: z.ZodObject;
  initialize(context: BeeContext): void | Promise<void>;
  process(input: unknown): string | Promise<string>;
  dispose?(): void | Promise<void>;
}