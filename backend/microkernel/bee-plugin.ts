import type { z } from "zod";

export interface BeeContext {
  getDataDir(): string;
  getModel(): string;
}

export interface PluginTestCase {
  query: string;
  shouldInvoke: boolean;
  expectedParams?: Record<string, unknown>;
  expectedOutputValues?: string[];
}

export interface BeePlugin {
  name: string;
  description: string;
  schema: z.ZodObject<any, any>;
  testCases: PluginTestCase[];
  initialize(context: BeeContext): void | Promise<void>;
  process(input: unknown): string | Promise<string>;
  dispose?(): void | Promise<void>;
}
