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
  await screen.findByText(testPlugin.name, { selector: ".font-mono" });
}

/** All tests start selected ("Select all" is checked by default); uncheck
 * it, then check only the one test card whose label we're given. */
async function selectOnly(testLabel: string) {
  await userEvent.click(screen.getByLabelText("Select all"));
  const card = screen.getByText(testLabel).closest("label") as HTMLElement;
  await userEvent.click(within(card).getByRole("checkbox"));
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

    const card = screen.getByText("echo hello").closest("label") as HTMLElement;
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
      expect(card.querySelector("svg.lucide-check")).toBeInTheDocument();
    });
    expect(card.querySelector("svg.lucide-x")).not.toBeInTheDocument();
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

    const card = screen
      .getByText("what's the weather today?")
      .closest("label") as HTMLElement;
    await userEvent.click(screen.getByRole("button", { name: /run selected/i }));

    await waitFor(() => {
      expect(mockApiClient.post).toHaveBeenCalledWith(
        `/api/plugins/${testPlugin.name}/test/selection/1`,
        {},
        expect.anything(),
      );
    });

    await waitFor(() => {
      expect(card.querySelector("svg.lucide-x")).toBeInTheDocument();
    });
    expect(card.querySelector("svg.lucide-check")).not.toBeInTheDocument();
    expect(screen.getByText(/Failure: Wrong tool selected/i)).toBeInTheDocument();
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

    const card = screen
      .getByText("echoes the given text")
      .closest("label") as HTMLElement;
    await userEvent.click(screen.getByRole("button", { name: /run selected/i }));

    await waitFor(() => {
      expect(card.querySelector("svg.lucide-check")).toBeInTheDocument();
    });

    await userEvent.click(within(card).getByRole("button", { name: /view results/i }));
    expect(await screen.findByText("hello")).toBeInTheDocument();
  });
});
