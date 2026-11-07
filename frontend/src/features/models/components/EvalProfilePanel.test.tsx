import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMockApiClient, ok, type MockRoute } from "@/test-utils/mockApiClient";
import type {
  EvalJob,
  MetricResult,
  ModelEvalProfileResponse,
  RunEstimate,
} from "@/features/models/api/getModelEvalProfile";
import { allModelChoices, type ModelChoice } from "@/features/models/lib/modelChoices";
import type { ModelOption } from "@/features/models/types";

/**
 * The model's eval profile and its "Evaluate" action, against a fake
 * backend: no evals actually run, no Ollama, no cloud calls.
 */
const { mockApiClient } = vi.hoisted(() => ({
  mockApiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    request: vi.fn(),
  },
}));

vi.mock("@/lib/apiClient", () => ({ apiClient: mockApiClient }));
vi.mock("@/lib/toastManager", () => ({ reportSuccess: vi.fn(), reportError: vi.fn() }));

function setRoutes(routes: MockRoute[]) {
  const real = createMockApiClient(routes);
  mockApiClient.get.mockImplementation(real.get);
  mockApiClient.post.mockImplementation(real.post);
  mockApiClient.delete.mockImplementation(real.delete);
}

const LOCAL: ModelChoice = { provider: "ollama", model: "qwen3:8b", keyId: "" };
const CLOUD: ModelChoice = { provider: "anthropic", model: "claude-haiku-4-5", keyId: "key-1" };
function localOption(model: string, label: string, capabilities: string[]): ModelOption {
  return { id: `ollama:${model}`, ref: { provider: "ollama", model }, label, capabilities };
}

// Built the way the app builds them, from the /api/models/options groups,
// whose option labels are size hints ("8.2B local"), not names.
const JUDGES = allModelChoices([
  {
    id: "local",
    label: "Local (Ollama)",
    provider: "ollama",
    options: [
      localOption("qwen3:8b", "8.2B local", ["completion", "tools"]),
      localOption("lfm2.5", "1.2B local", ["completion"]),
      localOption("nomic-embed-text", "137M local", ["embedding"]),
    ],
  },
]);

const SUITES: ModelEvalProfileResponse["suites"] = [
  { suite: "routing", categories: ["routing", "abstention", "param-extraction", "multi-turn"], needsJudge: false },
  { suite: "summarization", categories: ["summarization"], needsJudge: true },
];

function metric(overrides: Partial<MetricResult>): MetricResult {
  return {
    category: "routing",
    value: 0.92,
    level: "very-good",
    casesGraded: 6,
    casesUnjudged: 0,
    lowConfidence: false,
    date: "2026-11-05T12:00:00.000Z",
    casesVersion: "c1",
    inputTokens: 1000,
    outputTokens: 100,
    durationMs: 900,
    costUsd: 0,
    ...overrides,
  };
}

function response(overrides: Partial<ModelEvalProfileResponse> = {}): ModelEvalProfileResponse {
  return {
    profile: { model: "qwen3:8b", latest: {}, history: {} },
    status: {},
    suites: SUITES,
    ...overrides,
  };
}

function runningJob(overrides: Partial<EvalJob> = {}): EvalJob {
  return {
    model: "qwen3:8b",
    suites: ["routing"],
    status: "running",
    startedAt: "2026-11-06T10:00:00.000Z",
    current: { suite: "routing", index: 2, total: 17, name: "picks the counter plugin" },
    savedSuites: [],
    skipped: [],
    log: [],
    ...overrides,
  };
}

const LOCAL_BASE = "/api/models/qwen3%3A8b/eval-profile";
const CLOUD_BASE = "/api/models/anthropic%3Aclaude-haiku-4-5/eval-profile";

const FREE: RunEstimate = {
  suites: [{ suite: "routing", cases: 17, inputTokens: 1, outputTokens: 1, costUsd: 0, judgeCostUsd: 0, basedOn: "defaults" }],
  totalCostUsd: 0,
  requiresConfirmation: false,
};

async function renderPanel(model: ModelChoice = LOCAL) {
  const { EvalProfilePanel } = await import("./EvalProfilePanel");
  render(<EvalProfilePanel model={model} judgeChoices={JUDGES} />);
}

describe("Eval profile — what the model is good and bad at", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("a model never evaluated says so and offers to evaluate it", async () => {
    setRoutes([{ method: "get", match: LOCAL_BASE, handler: () => ok(response()) }]);
    await renderPanel();

    expect(await screen.findByText(/Not evaluated yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /evaluate/i })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /export/i })).not.toBeInTheDocument();
  });

  test("shows each metric's level, value, unjudged cases, confidence, staleness and evolution", async () => {
    const oldSummary = metric({ category: "summarization", value: 0.6, level: "fair", judgeModel: "lfm2.5" });
    const summary = metric({
      category: "summarization",
      value: 0.75,
      level: "good",
      casesGraded: 3,
      casesUnjudged: 1,
      lowConfidence: true,
      judgeModel: "claude-sonnet-5",
    });
    setRoutes([
      {
        method: "get",
        match: LOCAL_BASE,
        handler: () =>
          ok(
            response({
              profile: {
                model: "qwen3:8b",
                latest: { routing: metric({}), summarization: summary },
                history: { routing: [metric({})], summarization: [oldSummary, summary] },
              },
              status: {
                routing: { stale: true, reasons: ["case set changed (was 'c1', now 'c2')"], judgeChangedSincePrevious: false },
                summarization: { stale: false, reasons: [], judgeChangedSincePrevious: true },
              },
            }),
          ),
      },
    ]);
    await renderPanel();

    const routing = await screen.findByRole("group", { name: "routing" });
    expect(within(routing).getByText("Very good · 92%")).toBeInTheDocument();
    expect(within(routing).getByText(/Out of date: case set changed/)).toBeInTheDocument();

    const summarization = screen.getByRole("group", { name: "summarization" });
    expect(within(summarization).getByText("Good · 75%")).toBeInTheDocument();
    expect(within(summarization).getByText(/1 unjudged \(not counted\)/)).toBeInTheDocument();
    expect(within(summarization).getByText(/judge claude-sonnet-5/)).toBeInTheDocument();
    expect(within(summarization).getByText(/Low confidence/)).toBeInTheDocument();
    expect(within(summarization).getByText(/Evolution: 60% → 75% \(judge changed in the last run\)/)).toBeInTheDocument();
  });

  test("when the profile can't be loaded it says so, and Retry loads it again", async () => {
    let attempts = 0;
    setRoutes([
      {
        method: "get",
        match: LOCAL_BASE,
        handler: () => {
          attempts++;
          if (attempts === 1) throw new Error("Request failed with status code 500");
          return ok(response());
        },
      },
    ]);
    await renderPanel();

    expect(await screen.findByText("Couldn't load the eval profile.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(/Not evaluated yet/)).toBeInTheDocument();
  });

  test("evaluating a local model: pick categories and an independent judge, then follow progress and cancel", async () => {
    let state = response();
    const startBodies: unknown[] = [];
    setRoutes([
      { method: "get", match: LOCAL_BASE, handler: () => ok(state) },
      { method: "post", match: `${LOCAL_BASE}/estimate`, handler: () => ok(FREE) },
      {
        method: "post",
        match: `${LOCAL_BASE}/run`,
        handler: (body) => {
          startBodies.push(body);
          state = response({ job: runningJob() });
          return ok(state.job);
        },
      },
      {
        method: "delete",
        match: `${LOCAL_BASE}/run`,
        handler: () => {
          state = response({ job: runningJob({ status: "cancelled", current: undefined, savedSuites: ["execution"] }) });
          return ok(state.job);
        },
      },
    ]);
    await renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: /evaluate/i }));

    const form = screen.getByRole("form", { name: "Evaluate model" });
    // Everything is selected by default; the judged category needs a judge first.
    expect(within(form).getByLabelText(/Summarization \(judged\)/)).toBeChecked();
    const start = within(form).getByRole("button", { name: /start evaluation/i });
    expect(start).toBeDisabled();

    // Judges are listed by model name, grouped by where they run. The model
    // being evaluated and embedding-only models (they can't write) are left out.
    const judgeSelect = within(form).getByRole("combobox", { name: /judge model/i });
    const judgeOptions = within(judgeSelect).getAllByRole("option").map((o) => o.textContent);
    expect(judgeOptions).toEqual(["Choose a judge…", "lfm2.5"]);
    expect(within(judgeSelect).getByRole("group", { name: "Local (Ollama)" })).toBeInTheDocument();

    await userEvent.selectOptions(judgeSelect, "lfm2.5");
    expect(await within(form).findByText(/Estimated cost: free · 17 cases/)).toBeInTheDocument();
    expect(within(form).queryByText(/I accept the estimated cost/)).not.toBeInTheDocument();
    await waitFor(() => expect(start).toBeEnabled());

    await userEvent.click(start);
    expect(startBodies[0]).toEqual({
      executor: { provider: "ollama", model: "qwen3:8b", keyId: undefined },
      judge: { provider: "ollama", model: "lfm2.5", keyId: undefined },
      suites: ["routing", "summarization"],
      confirm: false,
    });

    // Running: shows which case is going and lets you stop it.
    const status = await screen.findByRole("status");
    expect(within(status).getByText(/routing · case 3\/17: picks the counter plugin/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /evaluate/i })).toBeDisabled();

    await userEvent.click(within(status).getByRole("button", { name: "Cancel" }));
    expect(mockApiClient.delete).toHaveBeenCalledWith(`${LOCAL_BASE}/run`);
    expect(
      await screen.findByText("Evaluation cancelled. Saved: execution. Unfinished categories kept their previous results."),
    ).toBeInTheDocument();
  });

  test("exact-match categories alone don't ask for a judge", async () => {
    setRoutes([
      { method: "get", match: LOCAL_BASE, handler: () => ok(response()) },
      { method: "post", match: `${LOCAL_BASE}/estimate`, handler: () => ok(FREE) },
    ]);
    await renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: /evaluate/i }));

    const form = screen.getByRole("form", { name: "Evaluate model" });
    await userEvent.click(within(form).getByLabelText(/Summarization \(judged\)/));
    expect(within(form).queryByRole("combobox", { name: /judge model/i })).not.toBeInTheDocument();
    await waitFor(() => expect(within(form).getByRole("button", { name: /start evaluation/i })).toBeEnabled());
  });

  test("a cloud model shows the estimated cost and can't start until it's accepted", async () => {
    const startBodies: unknown[] = [];
    setRoutes([
      { method: "get", match: CLOUD_BASE, handler: () => ok(response({ profile: { model: "anthropic:claude-haiku-4-5", latest: {}, history: {} } })) },
      {
        method: "post",
        match: `${CLOUD_BASE}/estimate`,
        handler: () => ok({ ...FREE, totalCostUsd: 0.42, requiresConfirmation: true }),
      },
      {
        method: "post",
        match: `${CLOUD_BASE}/run`,
        handler: (body) => {
          startBodies.push(body);
          return ok(runningJob({ model: "anthropic:claude-haiku-4-5" }));
        },
      },
    ]);
    await renderPanel(CLOUD);
    await userEvent.click(await screen.findByRole("button", { name: /evaluate/i }));

    const form = screen.getByRole("form", { name: "Evaluate model" });
    await userEvent.click(within(form).getByLabelText(/Summarization \(judged\)/));
    expect(await within(form).findByText(/Estimated cost: \$0\.42/)).toBeInTheDocument();

    const start = within(form).getByRole("button", { name: /start evaluation/i });
    expect(start).toBeDisabled();
    await userEvent.click(within(form).getByLabelText(/I accept the estimated cost/));
    expect(start).toBeEnabled();

    await userEvent.click(start);
    expect(startBodies[0]).toMatchObject({
      executor: { provider: "anthropic", model: "claude-haiku-4-5", keyId: "key-1" },
      suites: ["routing"],
      confirm: true,
    });
  });

  test("a failed run shows why, and skipped categories say what was missing", async () => {
    setRoutes([
      {
        method: "get",
        match: LOCAL_BASE,
        handler: () =>
          ok(
            response({
              job: runningJob({
                status: "failed",
                current: undefined,
                savedSuites: ["routing"],
                skipped: [{ suite: "summarization", reason: "no judge model chosen" }],
                log: ["Running: x", "Profiling 'generation' failed (Ollama is not running)"],
              }),
            }),
          ),
      },
    ]);
    await renderPanel();

    const status = await screen.findByRole("status");
    expect(
      within(status).getByText("Evaluation failed: Profiling 'generation' failed (Ollama is not running). Saved: routing."),
    ).toBeInTheDocument();
    expect(within(status).getByText("Skipped summarization: no judge model chosen")).toBeInTheDocument();
  });

  test("an evaluated profile can be exported with its results", async () => {
    setRoutes([
      {
        method: "get",
        match: LOCAL_BASE,
        handler: () =>
          ok(response({ profile: { model: "qwen3:8b", latest: { routing: metric({}) }, history: {} } })),
      },
      { method: "post", match: `${LOCAL_BASE}/export`, handler: () => ok({ path: "C:/Users/me/Downloads/qwen3-8b-eval-profile.html" }) },
    ]);
    const { reportSuccess } = await import("@/lib/toastManager");
    await renderPanel();

    await userEvent.click(await screen.findByRole("button", { name: "Export HTML" }));
    expect(mockApiClient.post).toHaveBeenCalledWith(`${LOCAL_BASE}/export`, undefined, { params: { format: "html" } });
    await waitFor(() =>
      expect(reportSuccess).toHaveBeenCalledWith("Profile exported", "C:/Users/me/Downloads/qwen3-8b-eval-profile.html"),
    );
  });
});
