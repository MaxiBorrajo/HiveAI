export type EditorMode = "view" | "edit";

/** Unsaved changes only exist while editing index.ts. */
export function isDirty(
  mode: EditorMode,
  current: string,
  saved: string,
): boolean {
  return mode === "edit" && current !== saved;
}

/** What leaving edit mode (or the editor) with unsaved changes should do next. */
export type LeaveTarget = "exit-edit" | "close";

export function buildFixPrompt(issues: string[]): string {
  return `The plugin failed validation with these errors. Fix them with the smallest possible change, keeping everything else as it is:\n${
    issues.map((issue) => `- ${issue}`).join("\n")
  }`;
}

/** Pairs the tool-call events of a test chat turn with their results. */
export interface TestToolRun {
  id: string;
  tool: string;
  input: unknown;
  status: "running" | "ok" | "error";
  output?: string;
}

export function startToolRun(
  runs: TestToolRun[],
  tool: string,
  input: unknown,
): TestToolRun[] {
  return [
    ...runs,
    { id: crypto.randomUUID(), tool, input, status: "running" },
  ];
}

export function finishToolRun(
  runs: TestToolRun[],
  tool: string,
  ok: boolean,
  output?: string,
): TestToolRun[] {
  const index = runs.findIndex((r) => r.tool === tool && r.status === "running");
  if (index === -1) return runs;
  const next = [...runs];
  next[index] = { ...next[index], status: ok ? "ok" : "error", output };
  return next;
}

/** True when the plugin declares settings but none has a value yet. */
export function needsConfiguration(
  fields: { masked: string | null; value: string | null }[] | null,
): boolean {
  if (!fields || fields.length === 0) return false;
  return fields.every((f) => f.masked === null && f.value === null);
}
