import { beforeEach, describe, expect, test, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { createMockApiClient, ok } from "@/test-utils/mockApiClient";
import type { FinishedListener } from "../hooks/useScheduleActivity";
import type { FinishedScheduleRun } from "../api/schedules";

/**
 * The glue between the background scheduler and this screen: a run that the
 * scheduler starts must look like one started here, and when it ends the
 * result has to be fresh (and open, if you are looking at it).
 */
const { mockApiClient, ctx } = vi.hoisted(() => ({
  mockApiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    request: vi.fn(),
  },
  ctx: { value: null as unknown },
}));

vi.mock("@/lib/apiClient", () => ({ apiClient: mockApiClient }));
vi.mock("@/lib/toastManager", () => ({ reportSuccess: vi.fn(), reportError: vi.fn() }));
vi.mock("../visual-builder", () => ({ VisualBuilder: () => <div data-testid="graph" /> }));
vi.mock("./history/RunComparisonModal", () => ({ RunComparisonModal: () => null }));
vi.mock("./ExecutionChatPanel", () => ({ ExecutionChatPanel: () => null }));
vi.mock("./node-details/NodeDetailsPanel", () => ({ NodeDetailsPanel: () => null }));
vi.mock("../ExecutionsContext", () => ({ useExecutions: () => ctx.value }));

import { ExecutionsMain } from "./ExecutionsMain";

const graph = {
  nodes: [
    { id: "start", name: "Start", type: "start", config: {} },
    { id: "end", name: "End", type: "end", config: { output: { type: "markdown", summary: "", contentKey: "" } } },
  ],
  edges: [{ id: "e1", source: "start", target: "end", isConditional: false }],
  stateSchema: { input: { type: "string", required: false } },
};

const lastResult = (text: string, iteration: number) => ({
  id: iteration,
  executionId: 1,
  iteration,
  result: { type: "markdown", summary: "Bee", content: text },
  finalState: {},
  createdAt: 1000 + iteration,
});

let currentLastResult: ReturnType<typeof lastResult> | null;
let listeners: Set<FinishedListener>;
let running: Set<string>;
// The backend sends execution ids as NUMBERS and the sidebar hands them over
// untouched, so at runtime the active id is a number even though it is typed
// as a string. The tests use the real shape.
let activeId: string;
const numericId = (id: number) => id as unknown as string;

function context() {
  return {
    executions: [{ id: numericId(1), name: "Daily digest", createdAt: 1, updatedAt: 1 }, { id: numericId(2), name: "Other", createdAt: 1, updatedAt: 1 }],
    activeExecutionId: activeId,
    newExecutionToken: "new",
    isLoadingExecutions: false,
    refreshExecutions: vi.fn(),
    selectExecution: vi.fn(),
    startNewExecution: vi.fn(),
    deleteExecution: vi.fn(),
    updateExecution: vi.fn(),
    renameExecution: vi.fn(),
    onExecutionCreated: vi.fn(),
    touchExecution: vi.fn(),
    scheduleActivity: {
      runningExecutionIds: running,
      finishedTick: 0,
      subscribe: (l: FinishedListener) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    },
  };
}

const finished = (status: FinishedScheduleRun["status"], executionId = 1): FinishedScheduleRun =>
  ({ id: 1, executionId, status, error: null, finishedAt: 1 });

async function deliver(run: FinishedScheduleRun) {
  let handled = false;
  await act(async () => {
    const answers = await Promise.all([...listeners].map((l) => l(run)));
    handled = answers.some(Boolean);
  });
  return handled;
}

beforeEach(() => {
  vi.clearAllMocks();
  currentLastResult = null;
  listeners = new Set();
  running = new Set();
  activeId = numericId(1);
  ctx.value = context();
  const real = createMockApiClient([
    {
      method: "get",
      match: /^\/api\/executions\/\d+$/,
      handler: () => ok({ execution: { id: 1 }, graph: { id: 1, graph, state: {}, createdAt: 1 }, lastResult: currentLastResult }),
    },
    { method: "get", match: /^\/api\/schedules\/executions\/\d+$/, handler: () => ok({ schedules: [], runs: [], inputRequired: false }) },
  ]);
  for (const m of ["get", "post", "put", "patch", "delete"] as const) mockApiClient[m].mockImplementation(real[m]);
});

describe("ExecutionsMain with the scheduler", () => {
  test("a run the scheduler is doing looks like a manual one: Running..., nothing to stop", async () => {
    const view = render(<ExecutionsMain />);
    expect(await screen.findByRole("button", { name: /run execution/i })).toBeEnabled();

    running = new Set(["1"]);
    ctx.value = context();
    view.rerender(<ExecutionsMain />);

    expect(await screen.findByRole("button", { name: /running/i })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /stop/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /edit/i })).toBeDisabled();
  });

  test("a run of ANOTHER execution does not lock this one", async () => {
    running = new Set(["2"]);
    ctx.value = context();
    render(<ExecutionsMain />);
    expect(await screen.findByRole("button", { name: /run execution/i })).toBeEnabled();
  });

  test("when it finishes while you are looking, the fresh result opens by itself", async () => {
    currentLastResult = lastResult("old result", 1);
    render(<ExecutionsMain />);
    await screen.findByRole("button", { name: /^result$/i });
    expect(screen.queryByText("old result")).not.toBeInTheDocument();

    currentLastResult = lastResult("fresh scheduled result", 2);
    expect(await deliver(finished("ok"))).toBe(true);

    expect(await screen.findByText("fresh scheduled result")).toBeInTheDocument();
  });

  test("the first scheduled result appears even if the execution had none yet", async () => {
    render(<ExecutionsMain />);
    await screen.findByRole("button", { name: /run execution/i });
    expect(screen.queryByRole("button", { name: /^result$/i })).not.toBeInTheDocument();

    currentLastResult = lastResult("first ever", 1);
    expect(await deliver(finished("ok"))).toBe(true);
    expect(await screen.findByText("first ever")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^result$/i })).toBeInTheDocument();
  });

  test("finished somewhere else: nothing opens here (a toast is the caller's job)", async () => {
    render(<ExecutionsMain />);
    await screen.findByRole("button", { name: /run execution/i });
    currentLastResult = lastResult("not for this screen", 1);
    expect(await deliver(finished("ok", 2))).toBe(false);
    expect(screen.queryByText("not for this screen")).not.toBeInTheDocument();
  });

  test("a failed run does not open the result, and is left to the toast", async () => {
    currentLastResult = lastResult("previous", 1);
    render(<ExecutionsMain />);
    await screen.findByRole("button", { name: /^result$/i });
    expect(await deliver(finished("failed"))).toBe(false);
    expect(screen.queryByText("previous")).not.toBeInTheDocument();
  });

  test("unsubscribes when the screen goes away", async () => {
    const view = render(<ExecutionsMain />);
    await waitFor(() => expect(listeners.size).toBe(1));
    view.unmount();
    expect(listeners.size).toBe(0);
  });
});
