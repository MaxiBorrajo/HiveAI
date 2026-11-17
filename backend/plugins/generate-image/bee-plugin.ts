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
  getConfig(key: string): Promise<string | undefined>;
  /**
   * Attaches a file to the reply (in a chat or a run), where the user can
   * preview and download it. Only images for now. Resolves to null when there
   * is nothing to attach it to, e.g. when the plugin is being tested.
   */
  createFile(
    fileName: string,
    bytes: Uint8Array,
    mimeType: string,
  ): Promise<{ fileName: string; sizeBytes: number } | null>;
}

export interface PluginConfigOption {
  value: string;
  label: string;
}

export interface PluginConfigField {
  key: string;
  label: string;
  secret?: boolean;
  /** Picked from a list instead of typed. */
  options?: PluginConfigOption[];
  /** Shown while the field is empty, e.g. the value used by default. */
  placeholder?: string;
  /** One line under the field explaining what it is for. */
  description?: string;
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
  returnDescription?: string;
  selectionTests: SelectionTestCase<S>[];
  executionTests: ExecutionTestCase<S>[];
  configFields?: PluginConfigField[];
  initialize(context: BeeContext): void | Promise<void>;
  process(
    input: z.infer<S>,
    options?: { signal?: AbortSignal },
  ): string | Promise<string>;
  dispose?(): void | Promise<void>;
}
