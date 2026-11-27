import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMockApiClient, ok, fail, type MockRoute } from "@/test-utils/mockApiClient";
import { testPlugin } from "../__tests__/fixtures";


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

function setRoutes(routes: MockRoute[]) {
  const real = createMockApiClient(routes);
  mockApiClient.get.mockImplementation(real.get);
  mockApiClient.post.mockImplementation(real.post);
  mockApiClient.put.mockImplementation(real.put);
  mockApiClient.patch.mockImplementation(real.patch);
  mockApiClient.delete.mockImplementation(real.delete);
  mockApiClient.request.mockImplementation(real.request);
}

function baseRoutes(): MockRoute[] {
  return [
    { method: "get", match: "/api/plugins", handler: () => ok([testPlugin]) },
    { method: "get", match: "/api/models", handler: () => ok([]) },
    { method: "get", match: "/api/models/options", handler: () => ok([]) },
    {
      method: "get",
      match: "/api/models/current",
      handler: () => ok({ model: "llama3", provider: "ollama", keyId: "" }),
    },
    {
      method: "get",
      match: "/api/models/embedding-status",
      handler: () => ok({ available: true, model: "nomic-embed-text" }),
    },
    { method: "get", match: "/api/drafts", handler: () => ok({ drafts: [] }) },
    { method: "get", match: "/api/interactions", handler: () => ok([]) },
  ];
}

// Test ids as built by buildPluginTestGroups: `${plugin}-${type}-${index in the fixture}`.
const SELECTION_POSITIVE = `${testPlugin.name}-selection-0`; // "echo hello"
const SELECTION_NEGATIVE = `${testPlugin.name}-selection-1`; // "what's the weather today?"
const EXECUTION_HAPPY = `${testPlugin.name}-execution-0`; // "echoes the given text"

async function renderPluginTests() {
  const { ModelsProvider } = await import("@/features/models/ModelsContext");
  const { DraftEditorProvider } = await import("@/features/drafts/DraftEditorContext");
  const { PluginsManager } = await import("../components/PluginsManager");

  render(
    <ModelsProvider>
      <DraftEditorProvider>
        <PluginsManager />
      </DraftEditorProvider>
    </ModelsProvider>,
  );

  await userEvent.click(screen.getByTestId("plugins-menu-trigger"));
  await userEvent.click(await screen.findByTestId("plugins-menu-manage"));
  await screen.findByTestId("plugins-list-title");
  await userEvent.click(screen.getByTestId(`plugin-tests-button-${testPlugin.name}`));
  await screen.findByTestId("tests-run-button");
}


function cardFor(testId: string) {
  return screen.getByTestId(`test-card-${testId}`);
}

function runButton() {
  return screen.getByTestId("tests-run-button");
}


async function selectOnly(testId: string) {
  await userEvent.click(screen.getByTestId("tests-select-all"));
  await userEvent.click(within(cardFor(testId)).getByTestId("test-card-checkbox"));
}

describe("Plugin test runner — invoking a plugin against a simulated model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("a selection test the simulated model approves (invokes the plugin) shows as passed", async () => {
    setRoutes([
      ...baseRoutes(),
      {

        method: "post",
        match: `/api/plugins/${testPlugin.name}/test/selection/0`,
        handler: () =>
          ok({
            failureCategory: undefined,
            details: { selectedTool: testPlugin.name, extractedParams: { text: "hello" } },
            metrics: { durationMs: 120, inputTokens: 40, outputTokens: 5, tokensPerSecond: 42 },
          }),
      },
    ]);
    await renderPluginTests();
    await selectOnly(SELECTION_POSITIVE);

    const card = cardFor(SELECTION_POSITIVE);
    await userEvent.click(runButton());

    await waitFor(() => {
      expect(mockApiClient.post).toHaveBeenCalledWith(
        `/api/plugins/${testPlugin.name}/test/selection/0`,
        {},
        expect.anything(),
      );
    });

    // Passed -> the card shows the success (check) icon, not the failure (x) one.
    await waitFor(() => {
      expect(within(card).queryByTestId("test-status-passed")).toBeInTheDocument();
    });
    expect(within(card).queryByTestId("test-status-failed")).not.toBeInTheDocument();
  });

  test("a selection test the simulated model rejects (does not invoke the plugin) shows as failed", async () => {
    setRoutes([
      ...baseRoutes(),
      {
        // test index 1 is the "negative" case: shouldInvoke is false, so the
        // test fails if the mocked model *did* select this plugin anyway.
        method: "post",
        match: `/api/plugins/${testPlugin.name}/test/selection/1`,
        handler: () =>
          fail(["Expected the model to NOT select this plugin, but it did."], {
            failureCategory: "Wrong tool selected",
            details: { selectedTool: testPlugin.name },
            metrics: { durationMs: 95, inputTokens: 30, outputTokens: 4, tokensPerSecond: 40 },
          }),
      },
    ]);
    await renderPluginTests();
    await selectOnly(SELECTION_NEGATIVE);

    const card = cardFor(SELECTION_NEGATIVE);
    await userEvent.click(runButton());

    await waitFor(() => {
      expect(mockApiClient.post).toHaveBeenCalledWith(
        `/api/plugins/${testPlugin.name}/test/selection/1`,
        {},
        expect.anything(),
      );
    });

    await waitFor(() => {
      expect(within(card).queryByTestId("test-status-failed")).toBeInTheDocument();
    });
    expect(within(card).queryByTestId("test-status-passed")).not.toBeInTheDocument();
    expect(within(card).getByTestId("test-failure-category")).toHaveTextContent(
      "Failure: Wrong tool selected",
    );
    // The concrete reason the backend gave, not just the category badge.
    expect(within(card).getByTestId("test-errors")).toHaveTextContent(
      "Expected the model to NOT select this plugin, but it did.",
    );
  });

  test("an execution test shows the plugin's actual output once run", async () => {
    setRoutes([
      ...baseRoutes(),
      {
        method: "post",
        match: `/api/plugins/${testPlugin.name}/test/execution/0`,
        handler: () =>
          ok({
            failureCategory: undefined,
            details: { output: "hello" },
            metrics: { durationMs: 12 },
          }),
      },
    ]);
    await renderPluginTests();
    await selectOnly(EXECUTION_HAPPY);

    const card = cardFor(EXECUTION_HAPPY);
    await userEvent.click(runButton());

    await waitFor(() => {
      expect(within(card).queryByTestId("test-status-passed")).toBeInTheDocument();
    });

    await userEvent.click(within(card).getByTestId("test-toggle-results"));
    expect(await within(card).findByTestId("test-output")).toHaveTextContent("hello");
  });
});

/** A promise the test resolves by hand, so a mocked backend call can be held
 * "in flight" while we look at the UI's running state. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("Plugin test runner — what the user sees while and after tests run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("shows the running state per test, then the summary once every test finished", async () => {
    const selection0 = deferred<unknown>();
    const selection1 = deferred<unknown>();
    const execution0 = deferred<unknown>();
    setRoutes([
      ...baseRoutes(),
      {
        method: "post",
        match: `/api/plugins/${testPlugin.name}/test/selection/0`,
        handler: () => selection0.promise,
      },
      {
        method: "post",
        match: `/api/plugins/${testPlugin.name}/test/selection/1`,
        handler: () => selection1.promise,
      },
      {
        method: "post",
        match: `/api/plugins/${testPlugin.name}/test/execution/0`,
        handler: () => execution0.promise,
      },
    ]);
    await renderPluginTests();

    // All three tests are selected by default.
    await userEvent.click(runButton());

    // Running: the button turns into Stop, a progress bar appears, and only
    // the test currently in flight shows a spinner.
    await waitFor(() => {
      expect(runButton()).toHaveTextContent(/stop/i);
    });
    expect(screen.getByTestId("tests-progress")).toHaveTextContent("0% (0/3)");
    expect(
      within(cardFor(SELECTION_POSITIVE)).queryByTestId("test-status-running"),
    ).toBeInTheDocument();
    expect(
      within(cardFor(SELECTION_NEGATIVE)).queryByTestId("test-status-running"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("test-summary")).not.toBeInTheDocument();

    selection0.resolve(
      ok({
        details: { selectedTool: testPlugin.name },
        metrics: { durationMs: 100, inputTokens: 40, outputTokens: 5 },
      }),
    );

    // First one done: check icon, progress advances, the spinner moves on.
    await waitFor(() => {
      expect(
        within(cardFor(SELECTION_POSITIVE)).queryByTestId("test-status-passed"),
      ).toBeInTheDocument();
    });
    expect(
      within(cardFor(SELECTION_POSITIVE)).queryByTestId("test-status-running"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("tests-progress")).toHaveTextContent("33% (1/3)");
    expect(
      within(cardFor(SELECTION_NEGATIVE)).queryByTestId("test-status-running"),
    ).toBeInTheDocument();

    selection1.resolve(
      fail(["Expected the model to NOT select this plugin, but it did."], {
        failureCategory: "Wrong tool selected",
        details: { selectedTool: testPlugin.name },
        metrics: { durationMs: 100, inputTokens: 30, outputTokens: 4 },
      }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("tests-progress")).toHaveTextContent("67% (2/3)");
    });

    execution0.resolve(ok({ details: { output: "hello" }, metrics: { durationMs: 100 } }));

    // Finished: the progress bar goes away, Run is back, and the summary
    // reports 2 of 3 passed — under 70%, so the pass rate is shown in red.
    expect(await screen.findByTestId("test-summary")).toBeInTheDocument();
    expect(screen.queryByTestId("tests-progress")).not.toBeInTheDocument();
    expect(runButton()).toHaveTextContent(/run selected/i);
    const passRate = screen.getByTestId("summary-pass-rate");
    expect(passRate).toHaveTextContent("67%");
    expect(passRate).toHaveClass("text-destructive");
    expect(screen.getByTestId("summary-passed-count")).toHaveTextContent("2/3");
    expect(screen.getByTestId("summary-selection-count")).toHaveTextContent("1/2");
    expect(screen.getByTestId("summary-execution-count")).toHaveTextContent("1/1");
  });

  test("an execution test the plugin fails shows the failure category and its reason", async () => {
    setRoutes([
      ...baseRoutes(),
      {
        method: "post",
        match: `/api/plugins/${testPlugin.name}/test/execution/0`,
        handler: () =>
          fail(["Plugin threw: 'text' must be a non-empty string."], {
            failureCategory: "Execution error",
            details: { output: "" },
            metrics: { durationMs: 8 },
          }),
      },
    ]);
    await renderPluginTests();
    await selectOnly(EXECUTION_HAPPY);

    const card = cardFor(EXECUTION_HAPPY);
    await userEvent.click(runButton());

    await waitFor(() => {
      expect(within(card).queryByTestId("test-status-failed")).toBeInTheDocument();
    });
    expect(within(card).queryByTestId("test-status-passed")).not.toBeInTheDocument();
    expect(within(card).getByTestId("test-failure-category")).toHaveTextContent(
      "Failure: Execution error",
    );
    expect(within(card).getByTestId("test-errors")).toHaveTextContent(
      "Plugin threw: 'text' must be a non-empty string.",
    );
  });

  test("when the backend call itself errors, the test fails showing the error message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    setRoutes([
      ...baseRoutes(),
      {
        method: "post",
        match: `/api/plugins/${testPlugin.name}/test/selection/0`,
        handler: () => {
          throw new Error("Request failed with status code 500");
        },
      },
    ]);
    await renderPluginTests();
    await selectOnly(SELECTION_POSITIVE);

    const card = cardFor(SELECTION_POSITIVE);
    await userEvent.click(runButton());

    await waitFor(() => {
      expect(within(card).queryByTestId("test-status-failed")).toBeInTheDocument();
    });
    expect(within(card).getByTestId("test-failure-category")).toHaveTextContent(
      "Failure: Exception",
    );
    expect(within(card).getByTestId("test-errors")).toHaveTextContent(
      "Request failed with status code 500",
    );
    consoleError.mockRestore();
  });

  test("pressing Stop aborts the running test and does not start the remaining ones", async () => {
    setRoutes([
      ...baseRoutes(),
      {
        // Never answers on its own; rejects like axios does once aborted.
        method: "post",
        match: `/api/plugins/${testPlugin.name}/test/selection/0`,
        handler: (_body, config) =>
          new Promise((_, reject) => {
            (config as { signal: AbortSignal }).signal.addEventListener("abort", () => {
              const err = new Error("canceled");
              err.name = "CanceledError";
              reject(err);
            });
          }),
      },
    ]);
    await renderPluginTests();

    const card = cardFor(SELECTION_POSITIVE);
    await userEvent.click(runButton());
    await waitFor(() => {
      expect(runButton()).toHaveTextContent(/stop/i);
    });
    await userEvent.click(runButton());

    expect(await within(card).findByTestId("test-errors")).toHaveTextContent(
      "Test aborted by user.",
    );
    expect(within(card).getByTestId("test-failure-category")).toHaveTextContent(
      "Failure: Aborted",
    );
    expect(within(card).queryByTestId("test-status-running")).not.toBeInTheDocument();
    expect(runButton()).toHaveTextContent(/run selected/i);

    const testCalls = mockApiClient.post.mock.calls.filter(([path]) =>
      String(path).includes("/test/"),
    );
    expect(testCalls).toHaveLength(1);
  });
});

describe("Plugin test runner — getting there and confirming the plugin's actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("the Tests button opens every test the plugin declares, all selected, and Back returns", async () => {
    setRoutes(baseRoutes());
    await renderPluginTests();

    expect(screen.getByTestId(`tests-group-count-${testPlugin.name}`)).toHaveTextContent(
      "(3 tests)",
    );
    for (const id of [SELECTION_POSITIVE, SELECTION_NEGATIVE, EXECUTION_HAPPY]) {
      expect(within(cardFor(id)).getByTestId("test-card-checkbox")).toBeChecked();
    }
    expect(screen.getByTestId("tests-select-all")).toBeChecked();

    await userEvent.click(screen.getByTestId("tests-back-button"));
    expect(await screen.findByTestId("plugins-list-title")).toBeInTheDocument();
    expect(screen.queryByTestId(`test-card-${EXECUTION_HAPPY}`)).not.toBeInTheDocument();
  });

  /**
   * An execution test runs the real plugin, which can stop and ask the user
   * for permission. The fake backend keeps the test call hanging and serves
   * that pending approval until the user answers it, then finishes the test
   * the way the plugin would for that answer.
   */
  function approvalRoutes(onDecision: (decision: "approve" | "reject") => unknown) {
    const execution = deferred<unknown>();
    let answered = false;
    const approval = {
      id: "int-1",
      pluginName: testPlugin.name,
      requestedAt: 0,
      payload: {
        kind: "approval",
        title: "echo_plugin wants to write a file",
        description: "Allow the plugin to write output.txt?",
        details: { path: "output.txt" },
      },
    };
    const answer = (decision: "approve" | "reject") => () => {
      answered = true;
      execution.resolve(onDecision(decision));
      return ok("ok");
    };

    return [
      ...baseRoutes().filter((r) => r.match !== "/api/interactions"),
      {
        method: "get",
        match: "/api/interactions",
        handler: () => ok(answered ? [] : [approval]),
      },
      {
        method: "post",
        match: `/api/plugins/${testPlugin.name}/test/execution/0`,
        handler: () => execution.promise,
      },
      { method: "post", match: "/api/interactions/int-1/approve", handler: answer("approve") },
      { method: "post", match: "/api/interactions/int-1/reject", handler: answer("reject") },
    ] satisfies MockRoute[];
  }

  test("approving the plugin's request inside the tests view lets the test finish and pass", async () => {
    setRoutes(
      approvalRoutes(() => ok({ details: { output: "hello" }, metrics: { durationMs: 20 } })),
    );
    await renderPluginTests();
    await selectOnly(EXECUTION_HAPPY);

    const card = cardFor(EXECUTION_HAPPY);
    await userEvent.click(runButton());

    // The request shows up while the test is still running.
    expect(await screen.findByTestId("interaction-title")).toHaveTextContent(
      "echo_plugin wants to write a file",
    );
    expect(screen.getByTestId("interaction-description")).toHaveTextContent(
      "Allow the plugin to write output.txt?",
    );
    expect(screen.getByTestId("interaction-detail-path")).toHaveTextContent("path: output.txt");
    expect(within(card).queryByTestId("test-status-running")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("interaction-approve"));

    expect(mockApiClient.post).toHaveBeenCalledWith("/api/interactions/int-1/approve");
    expect(mockApiClient.post).not.toHaveBeenCalledWith("/api/interactions/int-1/reject");
    await waitFor(() => {
      expect(within(card).queryByTestId("test-status-passed")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("interaction-approval")).not.toBeInTheDocument();
  });

  test("rejecting the plugin's request makes the test fail and shows why", async () => {
    setRoutes(
      approvalRoutes(() =>
        fail(["Output did not meet expectations. Output returned: Cancelled by the user."], {
          failureCategory: "Logic Error",
          details: { output: "Cancelled by the user." },
          metrics: { durationMs: 20 },
        }),
      ),
    );
    await renderPluginTests();
    await selectOnly(EXECUTION_HAPPY);

    const card = cardFor(EXECUTION_HAPPY);
    await userEvent.click(runButton());
    await screen.findByTestId("interaction-approval");

    await userEvent.click(screen.getByTestId("interaction-reject"));

    expect(mockApiClient.post).toHaveBeenCalledWith("/api/interactions/int-1/reject");
    expect(mockApiClient.post).not.toHaveBeenCalledWith("/api/interactions/int-1/approve");
    await waitFor(() => {
      expect(within(card).queryByTestId("test-status-failed")).toBeInTheDocument();
    });
    expect(within(card).getByTestId("test-failure-category")).toHaveTextContent(
      "Failure: Logic Error",
    );
    expect(within(card).getByTestId("test-errors")).toHaveTextContent(
      "Output did not meet expectations. Output returned: Cancelled by the user.",
    );
    expect(screen.queryByTestId("interaction-approval")).not.toBeInTheDocument();
  });
});
