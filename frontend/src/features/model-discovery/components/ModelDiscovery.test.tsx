import { describe, test, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMockApiClient, ok, type MockRoute } from "@/test-utils/mockApiClient";
import type { HardwareReport, ModelCard, SearchResultItem } from "../types";

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

import { HardwareSummary } from "./HardwareSummary";
import { ModelSearch } from "./ModelSearch";
import { ModelDetail } from "./ModelDetail";

const GB = 1024 ** 3;

function setRoutes(routes: MockRoute[]) {
  const real = createMockApiClient(routes);
  mockApiClient.get.mockImplementation(real.get);
}

const GPU_REPORT: HardwareReport = {
  profile: {
    totalMemBytes: 32 * GB,
    availableMemBytes: 24 * GB,
    gpu: { usable: true, name: "RTX 4070", vramBytes: 12 * GB, unifiedMemory: false },
  },
  context: { nCtx: 8192, pluginTokens: 1200, kvCacheType: "f16" },
  plugins: [{ name: "web-search", tokens: 1200 }],
  noToolModelFits: false,
  cloudSuggestion: null,
  hasCloudKey: false,
};

const NO_GPU_REPORT: HardwareReport = {
  profile: {
    totalMemBytes: 8 * GB,
    availableMemBytes: 1.5 * GB,
    gpu: { usable: false, unifiedMemory: false },
  },
  context: { nCtx: 8192, pluginTokens: 0, kvCacheType: "f16" },
  plugins: [],
  noToolModelFits: true,
  cloudSuggestion: { keyId: "k", alias: "work", provider: "anthropic", model: "claude-sonnet-5-5" },
  hasCloudKey: true,
};

const card = (id: string, paramsBillions: number): ModelCard => ({
  source: "huggingface",
  id,
  ollamaName: `hf.co/${id}`,
  paramsBillions,
  architecture: "qwen3",
  contextLength: 40960,
  downloads: 1500,
  likes: 3,
  license: "apache-2.0",
  capabilities: { tools: true, vision: false, reasoning: false },
});

const item = (id: string, paramsBillions: number, status: "fits" | "slow" | "no_fit", reason: string): SearchResultItem => ({
  card: card(id, paramsBillions),
  estimatedQ4Bytes: paramsBillions * 0.6 * GB,
  fit: { status, reason, requiredBytes: 0, usableContext: 8000 },
});

describe("HardwareSummary", () => {
  beforeEach(() => vi.clearAllMocks());

  test("GPU profile: shows RAM, VRAM and plugin context usage, no warning", async () => {
    setRoutes([{ method: "get", match: "/api/hardware", handler: () => ok(GPU_REPORT) }]);
    render(<HardwareSummary />);
    expect(await screen.findByTestId("hardware-memory")).toHaveTextContent(/RTX 4070/);
    expect(screen.getByTestId("hardware-memory")).toHaveTextContent(/12 GB VRAM/);
    // The component formats numbers in the machine's locale ("1,200" in
    // English, "1.200" in Spanish), so expect whatever this machine writes.
    const tokens = (1200).toLocaleString().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expect(screen.getByTestId("hardware-plugins")).toHaveTextContent(
      new RegExp(`1 active plugin use about ${tokens}`),
    );
    expect(screen.queryByTestId("hardware-warning")).not.toBeInTheDocument();
  });

  test("no-GPU profile: says so and suggests a cloud model when no tool model fits", async () => {
    setRoutes([{ method: "get", match: "/api/hardware", handler: () => ok(NO_GPU_REPORT) }]);
    render(<HardwareSummary />);
    expect(await screen.findByTestId("hardware-memory")).toHaveTextContent(/No usable GPU/);
    const alert = await screen.findByTestId("hardware-warning");
    expect(alert).toHaveTextContent("No local model with tool support runs well");
    expect(alert).toHaveTextContent("claude-sonnet-5-5");
  });

  test("no tool model fits and no API key: tells the user to add one", async () => {
    setRoutes([{
      method: "get",
      match: "/api/hardware",
      handler: () => ok({ ...NO_GPU_REPORT, cloudSuggestion: null, hasCloudKey: false }),
    }]);
    render(<HardwareSummary />);
    expect(await screen.findByTestId("hardware-warning")).toHaveTextContent("Add a cloud API key");
  });
});

describe("ModelSearch", () => {
  beforeEach(() => vi.clearAllMocks());

  test("lists results with a fit badge and the reason, and reports the selection", async () => {
    setRoutes([{
      method: "get",
      match: "/api/model-discovery/search",
      handler: () => ok({
        offline: false,
        items: [
          item("unsloth/Qwen3-8B-GGUF", 8, "fits", "Needs ~6.2 GB, fits in 12.0 GB of VRAM."),
          item("unsloth/Qwen3-32B-GGUF", 32, "no_fit", "Needs ~24 GB, only 5.7 GB of RAM is free."),
        ],
      }),
    }]);
    const onSelect = vi.fn();
    render(<ModelSearch onSelect={onSelect} />);

    const fitting = await screen.findByTestId("model-result-unsloth/Qwen3-8B-GGUF");
    const tooBig = screen.getByTestId("model-result-unsloth/Qwen3-32B-GGUF");
    expect(within(fitting).getByTestId("fit-badge")).toHaveTextContent("Fits your hardware");
    expect(within(tooBig).getByTestId("fit-badge")).toHaveTextContent("Too big");
    expect(within(tooBig).getByTestId("model-result-reason")).toHaveTextContent(
      /only 5.7 GB of RAM is free/,
    );

    await userEvent.click(fitting);
    expect(onSelect).toHaveBeenCalledWith("unsloth/Qwen3-8B-GGUF", "huggingface");
  });

  test("typing queries the backend", async () => {
    setRoutes([{ method: "get", match: "/api/model-discovery/search", handler: () => ok({ offline: false, items: [] }) }]);
    render(<ModelSearch onSelect={vi.fn()} />);
    await userEvent.type(screen.getByTestId("model-search-input"), "lfm");
    await waitFor(() =>
      expect(mockApiClient.get).toHaveBeenCalledWith("/api/model-discovery/search", { params: { q: "lfm", sort: "downloads" } })
    );
  });

  test("offline: explains that only recommended models are shown", async () => {
    setRoutes([{
      method: "get",
      match: "/api/model-discovery/search",
      handler: () => ok({ offline: true, items: [item("unsloth/Qwen3-4B-GGUF", 4, "fits", "ok")] }),
    }]);
    render(<ModelSearch onSelect={vi.fn()} />);
    // The search starts on the Ollama library, so that's the source it names.
    expect(await screen.findByTestId("model-search-offline")).toHaveTextContent(
      /ollama\.com is not reachable/,
    );
  });
});

describe("ModelSearch filters and paging", () => {
  beforeEach(() => vi.clearAllMocks());

  const route = (handler: (...args: unknown[]) => unknown): MockRoute => ({
    method: "get",
    match: "/api/model-discovery/search",
    handler,
  });
  const lastParams = () => {
    const calls = mockApiClient.get.mock.calls;
    return calls[calls.length - 1][1].params;
  };

  test("starts on Recommended and refetches with the chosen sort and filters", async () => {
    setRoutes([route(() => ok({ offline: false, nextCursor: null, items: [] }))]);
    render(<ModelSearch onSelect={vi.fn()} />);
    expect(screen.getByTestId("model-sort-recommended")).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(screen.getByTestId("model-sort-updated"));
    await userEvent.click(screen.getByTestId("model-filter-tools"));
    await userEvent.click(screen.getByTestId("model-filter-fitsOnly"));

    expect(screen.getByTestId("model-sort-updated")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("model-sort-recommended")).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(lastParams()).toEqual({ q: "", sort: "updated", tools: "1", fits: "1" }));
  });

  test("defaults to the Ollama library; Hugging Face is opt-in, warns, and offers more sorts", async () => {
    setRoutes([route(() => ok({ offline: false, nextCursor: null, items: [] }))]);
    render(<ModelSearch onSelect={vi.fn()} />);
    expect(screen.getByTestId("model-source-ollama")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("model-sort-trending")).not.toBeInTheDocument();
    expect(screen.queryByTestId("model-search-hf-note")).not.toBeInTheDocument();
    // The first search is debounced, so it hasn't been sent right after render.
    await waitFor(() => expect(lastParams()).toEqual({ q: "", sort: "recommended" }));

    await userEvent.click(screen.getByTestId("model-source-huggingface"));
    expect(screen.getByTestId("model-sort-trending")).toBeInTheDocument();
    expect(screen.getByTestId("model-search-hf-note")).toHaveTextContent("not verified with Ollama");
    await waitFor(() => expect(lastParams()).toEqual({ source: "huggingface", q: "", sort: "recommended" }));
  });

  test("a sort only Hugging Face has falls back to Recommended when switching back to the library", async () => {
    setRoutes([route(() => ok({ offline: false, nextCursor: null, items: [] }))]);
    render(<ModelSearch onSelect={vi.fn()} />);
    await userEvent.click(screen.getByTestId("model-source-huggingface"));
    await userEvent.click(screen.getByTestId("model-sort-trending"));
    await userEvent.click(screen.getByTestId("model-source-ollama"));
    expect(screen.getByTestId("model-sort-recommended")).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(lastParams()).toEqual({ q: "", sort: "recommended" }));
  });

  test("library results show the published sizes and report the library source", async () => {
    const libraryCard = {
      ...card("qwen3", 8),
      source: "ollama" as const,
      ollamaName: "qwen3",
      sizes: [0.6, 8, 32],
    };
    setRoutes([route(() =>
      ok({
        offline: false,
        nextCursor: null,
        items: [{
          card: libraryCard,
          estimatedQ4Bytes: 5 * GB,
          fit: { status: "fits", reason: "ok", requiredBytes: 0, usableContext: 8000 },
        }],
      })
    )]);
    const onSelect = vi.fn();
    render(<ModelSearch onSelect={onSelect} />);
    const result = await screen.findByTestId("model-result-qwen3");
    expect(within(result).getByTestId("model-result-sizes")).toHaveTextContent("0.6B · 8B · 32B");
    await userEvent.click(result);
    expect(onSelect).toHaveBeenCalledWith("qwen3", "ollama");
  });

  test("Load more appends the next page using the cursor", async () => {
    setRoutes([route((...args) => {
      const cursor = (args[0] as { params: { cursor?: string } }).params.cursor;
      return cursor
        ? ok({ offline: false, nextCursor: null, items: [item("a/second", 2, "fits", "ok")] })
        : ok({ offline: false, nextCursor: "c1", items: [item("a/first", 1, "fits", "ok")] });
    })]);
    render(<ModelSearch onSelect={vi.fn()} />);
    await screen.findByTestId("model-result-a/first");

    await userEvent.click(screen.getByTestId("model-search-load-more"));
    expect(await screen.findByTestId("model-result-a/second")).toBeInTheDocument();
    expect(screen.getByTestId("model-result-a/first")).toBeInTheDocument();
    expect(lastParams()).toMatchObject({ cursor: "c1" });
    expect(screen.queryByTestId("model-search-load-more")).not.toBeInTheDocument();
  });

  test("scrolling the sentinel into view loads the next page", async () => {
    let trigger: () => void = () => {};
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: (e: { isIntersecting: boolean }[]) => void) {
          trigger = () => cb([{ isIntersecting: true }]);
        }
        observe() {}
        disconnect() {}
      },
    );
    try {
      setRoutes([route((...args) => {
        const cursor = (args[0] as { params: { cursor?: string } }).params.cursor;
        return cursor
          ? ok({ offline: false, nextCursor: null, items: [item("a/second", 2, "fits", "ok")] })
          : ok({ offline: false, nextCursor: "c1", items: [item("a/first", 1, "fits", "ok")] });
      })]);
      render(<ModelSearch onSelect={vi.fn()} />);
      await screen.findByTestId("model-result-a/first");
      act(() => trigger());
      expect(await screen.findByTestId("model-result-a/second")).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("an empty filtered result offers to clear the filters", async () => {
    setRoutes([route(() => ok({ offline: false, nextCursor: null, items: [] }))]);
    render(<ModelSearch onSelect={vi.fn()} />);
    await userEvent.click(screen.getByTestId("model-filter-vision"));
    expect(await screen.findByTestId("model-search-empty")).toHaveTextContent(
      "No models match these filters.",
    );
    await userEvent.click(screen.getByTestId("model-search-clear-filters"));
    expect(screen.getByTestId("model-filter-vision")).toHaveAttribute("aria-pressed", "false");
  });

  test("shows the end of results once the cursor is exhausted", async () => {
    setRoutes([route(() => ok({ offline: false, nextCursor: null, items: [item("a/only", 1, "fits", "ok")] }))]);
    render(<ModelSearch onSelect={vi.fn()} />);
    await userEvent.click(screen.getByTestId("model-sort-downloads"));
    expect(await screen.findByTestId("model-search-end")).toBeInTheDocument();
  });
});

describe("ModelDetail", () => {
  beforeEach(() => vi.clearAllMocks());

  test("shows the description and per-quantization fit, and downloads the chosen one", async () => {
    setRoutes([{
      method: "get",
      match: "/api/model-discovery/model",
      handler: () => ok({
        card: card("unsloth/Qwen3-8B-GGUF", 8),
        readmeSummary: "Qwen3 is a text model for local agents.",
        readme: "Qwen3 is a text model for local agents.\n\nMore details.",
        bestQuantization: "Q4_K_M",
        quantizations: [
          {
            quant: { name: "Q4_K_M", sizeBytes: 5 * GB, ollamaName: "hf.co/unsloth/Qwen3-8B-GGUF:Q4_K_M" },
            fit: { status: "fits", reason: "Needs ~6.2 GB, fits in VRAM.", requiredBytes: 0, usableContext: 8000 },
          },
          {
            quant: { name: "Q8_0", sizeBytes: 9 * GB, ollamaName: "hf.co/unsloth/Qwen3-8B-GGUF:Q8_0" },
            fit: { status: "slow", reason: "Part of the model runs on CPU.", requiredBytes: 0, usableContext: 8000 },
          },
        ],
      }),
    }]);
    const onDownload = vi.fn();
    render(<ModelDetail id="unsloth/Qwen3-8B-GGUF" onBack={vi.fn()} onDownload={onDownload} />);

    expect(await screen.findByTestId("model-detail-description")).toHaveTextContent(
      "Qwen3 is a text model for local agents.",
    );
    const q4 = screen.getByTestId("model-quant-Q4_K_M");
    const q8 = screen.getByTestId("model-quant-Q8_0");
    expect(within(q4).getByTestId("model-quant-recommended")).toBeInTheDocument();
    expect(within(q8).queryByTestId("model-quant-recommended")).not.toBeInTheDocument();
    expect(within(q8).getByTestId("fit-badge")).toHaveTextContent("Runs slowly");

    await userEvent.click(within(q4).getByTestId("model-quant-download"));
    expect(onDownload).toHaveBeenCalledWith("hf.co/unsloth/Qwen3-8B-GGUF:Q4_K_M");
  });

  test("shows an error when the model cannot be loaded", async () => {
    setRoutes([{
      method: "get",
      match: "/api/model-discovery/model",
      handler: () => ({ success: false, errors: ["Hugging Face could not be reached."] }),
    }]);
    render(<ModelDetail id="a/b" onBack={vi.fn()} onDownload={vi.fn()} />);
    expect(await screen.findByTestId("model-detail-error")).toHaveTextContent(
      "Hugging Face could not be reached.",
    );
  });
});
