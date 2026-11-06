import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMockApiClient, ok, fail, type MockRoute } from "@/test-utils/mockApiClient";
import { testPlugin } from "../__tests__/fixtures";

/**
 * This is the "invoke the plugin with a simulated model" half of the plugin
 * flow the user story asks for: HiveAI's real test runner (PluginTestsView
 * -> usePluginTestRunner -> runPluginTest -> POST /api/plugins/:name/test/
 * :type/:index) asks the backend to run one of the plugin's declared test
 * cases. The backend is the one that talks to the LLM; from the frontend's
 * side we mock that one HTTP call to stand in for "the model decided to use
 * this plugin" (or not), and check the UI renders the right pass/fail
 * outcome — no real model, no network.
 *
 * Rendered through the real PluginsManager entry point (Plugins menu ->
 * Manage -> Tests) rather than PluginTestsView in isolation, since it needs
 * a <Dialog.Root> ancestor its own DialogHeader/DialogTitle require.
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

  await userEvent.click(screen.getByTitle("Plugins"));
  await userEvent.click(await screen.findByText("Manage Plugins..."));
  await screen.findByText("Manage Plugins");
  await userEvent.click(screen.getByRole("button", { name: /tests/i }));
  await screen.findByRole("button", { name: /run selected/i });
}

/** Each test card is a group named after its label; its status icon is an
 * image named "Running", "Passed" or "Failed". */
function cardFor(testLabel: string) {
  return screen.getByRole("group", { name: testLabel });
}

/** All tests start selected ("Select all" is checked by default); uncheck
 * it, then check only the one test card whose label we're given. */
async function selectOnly(testLabel: string) {
  await userEvent.click(screen.getByLabelText("Select all"));
  await userEvent.click(within(cardFor(testLabel)).getByRole("checkbox"));
}

describe("Plugin test runner — invoking a plugin against a simulated model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("a selection test the simulated model approves (invokes the plugin) shows as passed", async () => {
    setRoutes([
      ...baseRoutes(),
      {
        // test index 0 is the "positive" case: the model is expected to pick
        // echo_plugin for this query, and the mock simulates it doing so.
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
    await selectOnly("echo hello");

    const card = cardFor("echo hello");
    await userEvent.click(screen.getByRole("button", { name: /run selected/i }));

    await waitFor(() => {
      expect(mockApiClient.post).toHaveBeenCalledWith(
        `/api/plugins/${testPlugin.name}/test/selection/0`,
        {},
        expect.anything(),
      );
    });

    // Passed -> the card shows the success (check) icon, not the failure (x) one.
    await waitFor(() => {
      expect(within(card).queryByRole("img", { name: "Passed" })).toBeInTheDocument();
    });
    expect(within(card).queryByRole("img", { name: "Failed" })).not.toBeInTheDocument();
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
    await selectOnly("what's the weather today?");

    const card = cardFor("what's the weather today?");
    await userEvent.click(screen.getByRole("button", { name: /run selected/i }));

    await waitFor(() => {
      expect(mockApiClient.post).toHaveBeenCalledWith(
        `/api/plugins/${testPlugin.name}/test/selection/1`,
        {},
        expect.anything(),
      );
    });

    await waitFor(() => {
      expect(within(card).queryByRole("img", { name: "Failed" })).toBeInTheDocument();
    });
    expect(within(card).queryByRole("img", { name: "Passed" })).not.toBeInTheDocument();
    expect(screen.getByText(/Failure: Wrong tool selected/i)).toBeInTheDocument();
    // The concrete reason the backend gave, not just the category badge.
    expect(
      within(card).getByText("Expected the model to NOT select this plugin, but it did."),
    ).toBeInTheDocument();
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
    await selectOnly("echoes the given text");

    const card = cardFor("echoes the given text");
    await userEvent.click(screen.getByRole("button", { name: /run selected/i }));

    await waitFor(() => {
      expect(within(card).queryByRole("img", { name: "Passed" })).toBeInTheDocument();
    });

    await userEvent.click(within(card).getByRole("button", { name: /view results/i }));
    expect(await screen.findByText("hello")).toBeInTheDocument();
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
    await userEvent.click(screen.getByRole("button", { name: /run selected/i }));

    // Running: the button turns into Stop, a progress bar appears, and only
    // the test currently in flight shows a spinner.
    expect(await screen.findByRole("button", { name: /stop/i })).toBeInTheDocument();
    expect(screen.getByText("0% (0/3)")).toBeInTheDocument();
    expect(within(cardFor("echo hello")).queryByRole("img", { name: "Running" })).toBeInTheDocument();
    expect(
      within(cardFor("what's the weather today?")).queryByRole("img", { name: "Running" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Execution Summary")).not.toBeInTheDocument();

    selection0.resolve(
      ok({
        details: { selectedTool: testPlugin.name },
        metrics: { durationMs: 100, inputTokens: 40, outputTokens: 5 },
      }),
    );

    // First one done: check icon, progress advances, the spinner moves on.
    await waitFor(() => {
      expect(within(cardFor("echo hello")).queryByRole("img", { name: "Passed" })).toBeInTheDocument();
    });
    expect(within(cardFor("echo hello")).queryByRole("img", { name: "Running" })).not.toBeInTheDocument();
    expect(screen.getByText("33% (1/3)")).toBeInTheDocument();
    expect(
      within(cardFor("what's the weather today?")).queryByRole("img", { name: "Running" }),
    ).toBeInTheDocument();

    selection1.resolve(
      fail(["Expected the model to NOT select this plugin, but it did."], {
        failureCategory: "Wrong tool selected",
        details: { selectedTool: testPlugin.name },
        metrics: { durationMs: 100, inputTokens: 30, outputTokens: 4 },
      }),
    );
    await waitFor(() => {
      expect(screen.getByText("67% (2/3)")).toBeInTheDocument();
    });

    execution0.resolve(ok({ details: { output: "hello" }, metrics: { durationMs: 100 } }));

    // Finished: the progress bar goes away, Run is back, and the summary
    // reports 2 of 3 passed — under 70%, so the pass rate is shown in red.
    expect(await screen.findByText("Execution Summary")).toBeInTheDocument();
    expect(screen.queryByText(/\(\d+\/3\)/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run selected/i })).toBeInTheDocument();
    expect(screen.getByText("67%")).toHaveClass("text-destructive");
    expect(screen.getByText("2/3")).toBeInTheDocument();
    expect(screen.getByText("Selection:").nextElementSibling).toHaveTextContent("1/2");
    expect(screen.getByText("Execution:").nextElementSibling).toHaveTextContent("1/1");
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
    await selectOnly("echoes the given text");

    const card = cardFor("echoes the given text");
    await userEvent.click(screen.getByRole("button", { name: /run selected/i }));

    await waitFor(() => {
      expect(within(card).queryByRole("img", { name: "Failed" })).toBeInTheDocument();
    });
    expect(within(card).queryByRole("img", { name: "Passed" })).not.toBeInTheDocument();
    expect(within(card).getByText(/Failure: Execution error/i)).toBeInTheDocument();
    expect(
      within(card).getByText("Plugin threw: 'text' must be a non-empty string."),
    ).toBeInTheDocument();
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
    await selectOnly("echo hello");

    const card = cardFor("echo hello");
    await userEvent.click(screen.getByRole("button", { name: /run selected/i }));

    await waitFor(() => {
      expect(within(card).queryByRole("img", { name: "Failed" })).toBeInTheDocument();
    });
    expect(within(card).getByText(/Failure: Exception/i)).toBeInTheDocument();
    expect(within(card).getByText("Request failed with status code 500")).toBeInTheDocument();
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

    const card = cardFor("echo hello");
    await userEvent.click(screen.getByRole("button", { name: /run selected/i }));
    await userEvent.click(await screen.findByRole("button", { name: /stop/i }));

    expect(await within(card).findByText("Test aborted by user.")).toBeInTheDocument();
    expect(within(card).getByText(/Failure: Aborted/i)).toBeInTheDocument();
    expect(within(card).queryByRole("img", { name: "Running" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run selected/i })).toBeInTheDocument();

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

    expect(screen.getByText("(3 tests)")).toBeInTheDocument();
    for (const label of ["echo hello", "what's the weather today?", "echoes the given text"]) {
      expect(within(cardFor(label)).getByRole("checkbox")).toBeChecked();
    }
    expect(screen.getByLabelText("Select all")).toBeChecked();

    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("Manage Plugins")).toBeInTheDocument();
    expect(screen.queryByText("echoes the given text")).not.toBeInTheDocument();
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
    await selectOnly("echoes the given text");

    const card = cardFor("echoes the given text");
    await userEvent.click(screen.getByRole("button", { name: /run selected/i }));

    // The request shows up while the test is still running.
    expect(await screen.findByText("echo_plugin wants to write a file")).toBeInTheDocument();
    expect(screen.getByText("Allow the plugin to write output.txt?")).toBeInTheDocument();
    expect(screen.getByText("path: output.txt")).toBeInTheDocument();
    expect(within(card).queryByRole("img", { name: "Running" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Aprobar" }));

    expect(mockApiClient.post).toHaveBeenCalledWith("/api/interactions/int-1/approve");
    expect(mockApiClient.post).not.toHaveBeenCalledWith("/api/interactions/int-1/reject");
    await waitFor(() => {
      expect(within(card).queryByRole("img", { name: "Passed" })).toBeInTheDocument();
    });
    expect(screen.queryByText("echo_plugin wants to write a file")).not.toBeInTheDocument();
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
    await selectOnly("echoes the given text");

    const card = cardFor("echoes the given text");
    await userEvent.click(screen.getByRole("button", { name: /run selected/i }));
    await screen.findByText("echo_plugin wants to write a file");

    await userEvent.click(screen.getByRole("button", { name: "Rechazar" }));

    expect(mockApiClient.post).toHaveBeenCalledWith("/api/interactions/int-1/reject");
    expect(mockApiClient.post).not.toHaveBeenCalledWith("/api/interactions/int-1/approve");
    await waitFor(() => {
      expect(within(card).queryByRole("img", { name: "Failed" })).toBeInTheDocument();
    });
    expect(within(card).getByText(/Failure: Logic Error/i)).toBeInTheDocument();
    expect(
      within(card).getByText(
        "Output did not meet expectations. Output returned: Cancelled by the user.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("echo_plugin wants to write a file")).not.toBeInTheDocument();
  });
});
