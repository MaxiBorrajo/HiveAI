export type StepKind = "thinking" | "tool" | "validating" | "correction";

export interface ToolRun {
  name: string;
  input: unknown;
  status: "running" | "ok" | "error";
  output?: string;
}

export interface ThreadStep {
  id: string;
  kind: StepKind;
  text: string;
  tool?: ToolRun;
}

export interface ThreadTurn {
  id: string;
  prompt: string;
  steps: ThreadStep[];
  status: "running" | "done" | "error";
  summary?: string;
  error?: string;
  /** index.ts before the turn started, so the change can be shown or undone. */
  before: string;
  /** index.ts the turn ended with (only when it finished successfully). */
  after?: string;
}

export function startTurn(
  id: string,
  prompt: string,
  before: string,
): ThreadTurn {
  return { id, prompt, steps: [], status: "running", before };
}

export function addStep(
  turn: ThreadTurn,
  kind: StepKind,
  text: string,
): ThreadTurn {
  return {
    ...turn,
    steps: [...turn.steps, { id: crypto.randomUUID(), kind, text }],
  };
}

export function addToolCall(
  turn: ThreadTurn,
  name: string,
  input: unknown,
): ThreadTurn {
  const step: ThreadStep = {
    id: crypto.randomUUID(),
    kind: "tool",
    text: name,
    tool: { name, input, status: "running" },
  };
  return { ...turn, steps: [...turn.steps, step] };
}

/** Closes the oldest still-running call of that tool. */
export function resolveToolCall(
  turn: ThreadTurn,
  name: string,
  ok: boolean,
  output?: string,
): ThreadTurn {
  const index = turn.steps.findIndex(
    (s) => s.tool?.name === name && s.tool.status === "running",
  );
  if (index === -1) return turn;
  const steps = [...turn.steps];
  const step = steps[index];
  steps[index] = {
    ...step,
    tool: { ...step.tool!, status: ok ? "ok" : "error", output },
  };
  return { ...turn, steps };
}

export function finishTurn(
  turn: ThreadTurn,
  summary: string | undefined,
  after: string,
): ThreadTurn {
  return { ...turn, status: "done", summary, after };
}

export function failTurn(turn: ThreadTurn, error: string): ThreadTurn {
  return { ...turn, status: "error", error };
}

/** A one-line description of tool input, e.g. the search query. */
export function describeToolInput(input: unknown, max = 70): string {
  if (input && typeof input === "object") {
    const first = Object.values(input as Record<string, unknown>).find(
      (v) => typeof v === "string" && v.trim(),
    );
    if (typeof first === "string") {
      return first.length > max ? `${first.slice(0, max - 1)}…` : first;
    }
  }
  return "";
}

export function hasChanges(turn: ThreadTurn): boolean {
  return turn.after !== undefined && turn.after !== turn.before;
}
