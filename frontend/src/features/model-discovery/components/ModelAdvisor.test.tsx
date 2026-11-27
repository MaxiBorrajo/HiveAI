import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMockApiClient, ok, type MockRoute } from "@/test-utils/mockApiClient";
import type { ModelCard, SearchResultItem } from "../types";
import type { AdvisorChoice } from "./ModelAdvisorBar";

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

import { ModelSearch } from "./ModelSearch";

const card = (id: string): ModelCard => ({
  source: "ollama",
  id,
  ollamaName: id,
  paramsBillions: 8,
  architecture: null,
  contextLength: 8192,
  downloads: 10,
  likes: 0,
  license: null,
  capabilities: { tools: true, vision: false, reasoning: false },
});

const item = (id: string, status: "fits" | "no_fit" = "fits"): SearchResultItem => ({
  card: card(id),
  fit: { status, reason: status === "fits" ? "Fits in VRAM." : "Too big.", requiredBytes: 1, usableContext: 8192 },
  estimatedQ4Bytes: 5e9,
});

const CHOICES: AdvisorChoice[] = [
  { choice: { provider: "ollama", model: "qwen3:8b", keyId: "" }, label: "qwen3:8b", group: "Local (Ollama)" },
  { choice: { provider: "anthropic", model: "claude-haiku-4-5", keyId: "k1" }, label: "claude-haiku-4-5", group: "Anthropic · work" },
];

function setup(suggest: () => unknown) {
  const routes: MockRoute[] = [
    {
      method: "get",
      match: "/api/model-discovery/search",
      handler: () => ok({ offline: false, items: [item("llama3.2"), item("gemma3")] }),
    },
    { method: "post", match: "/api/model-discovery/suggest", handler: suggest },
  ];
  const real = createMockApiClient(routes);
  mockApiClient.get.mockImplementation(real.get);
  mockApiClient.post.mockImplementation(real.post);
}

const renderSearch = (defaultChoice = CHOICES[0].choice) =>
  render(<ModelSearch onSelect={vi.fn()} advisorChoices={CHOICES} advisorDefault={defaultChoice} />);

async function ask(text: string) {
  await userEvent.type(screen.getByTestId("model-advisor-input"), text);
  await userEvent.click(screen.getByTestId("model-advisor-submit"));
}

describe("Model advisor in Explore models", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  test("the answer is a list of models below, not text", async () => {
    setup(() => ok({
      items: [item("gemma3")],
      reasons: { gemma3: "Small, reads images and fits your GPU." },
    }));
    renderSearch();
    await screen.findByTestId("model-result-llama3.2");

    await ask("something for images");

    const advice = await screen.findByTestId("model-advice");
    const result = within(advice).getByTestId("model-result-gemma3");
    expect(within(result).getByTestId("model-result-advice")).toHaveTextContent("reads images");
    expect(within(result).getByTestId("fit-badge")).toHaveTextContent("Fits your hardware");
    // the normal library list is replaced
    expect(screen.queryByTestId("model-result-llama3.2")).toBeNull();
  });

  test("asks the default model, or the one the user picks, with the request", async () => {
    setup(() => ok({ items: [], reasons: {}, message: "No model matches." }));
    renderSearch();
    await screen.findByTestId("model-result-llama3.2");

    await ask("coding");
    await waitFor(() =>
      expect(mockApiClient.post).toHaveBeenCalledWith("/api/model-discovery/suggest", {
        query: "coding",
        model: CHOICES[0].choice,
      }),
    );

    await userEvent.selectOptions(
      screen.getByTestId("model-advisor-model"),
      JSON.stringify(["anthropic", "k1", "claude-haiku-4-5"]),
    );
    await userEvent.click(screen.getByTestId("model-advisor-submit"));
    await waitFor(() =>
      expect(mockApiClient.post).toHaveBeenLastCalledWith("/api/model-discovery/suggest", {
        query: "coding",
        model: CHOICES[1].choice,
      }),
    );
  });

  test("when nothing matches it says so instead of listing models", async () => {
    setup(() => ok({ items: [], reasons: {}, message: "No model in the library clearly matches that request." }));
    renderSearch();
    await screen.findByTestId("model-result-llama3.2");
    await ask("a model that does my taxes");
    expect(await screen.findByTestId("model-advice-empty")).toHaveTextContent(/clearly matches/);
  });

  test("'All models' goes back to the normal list", async () => {
    setup(() => ok({ items: [item("gemma3")], reasons: { gemma3: "ok" } }));
    renderSearch();
    await screen.findByTestId("model-result-llama3.2");
    await ask("anything");
    await screen.findByTestId("model-advice");

    await userEvent.click(screen.getByTestId("model-advice-clear"));
    expect(screen.queryByTestId("model-advice")).toBeNull();
    expect(await screen.findByTestId("model-result-llama3.2")).toBeInTheDocument();
  });

  test("a failure is shown and the library list stays", async () => {
    setup(() => ({ success: false, errors: ["The model could not answer."] }));
    renderSearch();
    await screen.findByTestId("model-result-llama3.2");
    await ask("anything");
    expect(await screen.findByTestId("model-advisor-error")).toHaveTextContent("could not answer");
    expect(screen.getByTestId("model-result-llama3.2")).toBeInTheDocument();
  });

  test("without models to ask, the advisor is not shown", async () => {
    setup(() => ok({ items: [], reasons: {} }));
    render(<ModelSearch onSelect={vi.fn()} />);
    await screen.findByTestId("model-result-llama3.2");
    expect(screen.queryByTestId("model-advisor")).toBeNull();
  });
});
