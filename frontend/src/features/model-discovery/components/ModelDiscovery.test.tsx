import { describe, test, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
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
    expect(await screen.findByText(/RTX 4070/)).toBeInTheDocument();
    expect(screen.getByText(/12 GB VRAM/)).toBeInTheDocument();
    expect(screen.getByText(/1 active plugin use about 1,200/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("no-GPU profile: says so and suggests a cloud model when no tool model fits", async () => {
    setRoutes([{ method: "get", match: "/api/hardware", handler: () => ok(NO_GPU_REPORT) }]);
    render(<HardwareSummary />);
    expect(await screen.findByText(/No usable GPU/)).toBeInTheDocument();
    const alert = await screen.findByRole("alert");
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
    expect(await screen.findByRole("alert")).toHaveTextContent("Add a cloud API key");
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

    expect(await screen.findByText("Fits your hardware")).toBeInTheDocument();
    expect(screen.getByText("Too big")).toBeInTheDocument();
    expect(screen.getByText(/only 5.7 GB of RAM is free/)).toBeInTheDocument();

    await userEvent.click(screen.getByText("unsloth/Qwen3-8B-GGUF"));
    expect(onSelect).toHaveBeenCalledWith("unsloth/Qwen3-8B-GGUF", "huggingface");
  });

  test("typing queries the backend", async () => {
    setRoutes([{ method: "get", match: "/api/model-discovery/search", handler: () => ok({ offline: false, items: [] }) }]);
    render(<ModelSearch onSelect={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Search models"), "lfm");
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
    expect(await screen.findByText(/Hugging Face is not reachable/)).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Recommended" })).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(screen.getByRole("button", { name: "Newest" }));
    await userEvent.click(screen.getByRole("button", { name: "Tools" }));
    await userEvent.click(screen.getByRole("button", { name: "Fits my hardware" }));

    expect(screen.getByRole("button", { name: "Newest" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Recommended" })).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(lastParams()).toEqual({ q: "", sort: "updated", tools: "1", fits: "1" }));
  });

  test("defaults to the Ollama library; Hugging Face is opt-in, warns, and offers more sorts", async () => {
    setRoutes([route(() => ok({ offline: false, nextCursor: null, items: [] }))]);
    render(<ModelSearch onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Ollama library" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "Trending" })).not.toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(lastParams()).toEqual({ q: "", sort: "recommended" });

    await userEvent.click(screen.getByRole("button", { name: "Hugging Face" }));
    expect(screen.getByRole("button", { name: "Trending" })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("not verified with Ollama");
    await waitFor(() => expect(lastParams()).toEqual({ source: "huggingface", q: "", sort: "recommended" }));
  });

  test("a sort only Hugging Face has falls back to Recommended when switching back to the library", async () => {
    setRoutes([route(() => ok({ offline: false, nextCursor: null, items: [] }))]);
    render(<ModelSearch onSelect={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Hugging Face" }));
    await userEvent.click(screen.getByRole("button", { name: "Trending" }));
    await userEvent.click(screen.getByRole("button", { name: "Ollama library" }));
    expect(screen.getByRole("button", { name: "Recommended" })).toHaveAttribute("aria-pressed", "true");
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
    expect(await screen.findByText("0.6B · 8B · 32B")).toBeInTheDocument();
    await userEvent.click(screen.getByText("qwen3"));
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
    await screen.findByText("a/first");

    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("a/second")).toBeInTheDocument();
    expect(screen.getByText("a/first")).toBeInTheDocument();
    expect(lastParams()).toMatchObject({ cursor: "c1" });
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
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
      await screen.findByText("a/first");
      act(() => trigger());
      expect(await screen.findByText("a/second")).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("an empty filtered result offers to clear the filters", async () => {
    setRoutes([route(() => ok({ offline: false, nextCursor: null, items: [] }))]);
    render(<ModelSearch onSelect={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Vision" }));
    expect(await screen.findByText("No models match these filters.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("button", { name: "Vision" })).toHaveAttribute("aria-pressed", "false");
  });

  test("shows the end of results once the cursor is exhausted", async () => {
    setRoutes([route(() => ok({ offline: false, nextCursor: null, items: [item("a/only", 1, "fits", "ok")] }))]);
    render(<ModelSearch onSelect={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Most downloaded" }));
    expect(await screen.findByText("End of results")).toBeInTheDocument();
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

    expect(await screen.findByText("Qwen3 is a text model for local agents.")).toBeInTheDocument();
    expect(screen.getByText("Recommended")).toBeInTheDocument();
    expect(screen.getByText("Runs slowly")).toBeInTheDocument();

    const buttons = screen.getAllByRole("button", { name: /Download/ });
    await userEvent.click(buttons[0]);
    expect(onDownload).toHaveBeenCalledWith("hf.co/unsloth/Qwen3-8B-GGUF:Q4_K_M");
  });

  test("shows an error when the model cannot be loaded", async () => {
    setRoutes([{
      method: "get",
      match: "/api/model-discovery/model",
      handler: () => ({ success: false, errors: ["Hugging Face could not be reached."] }),
    }]);
    render(<ModelDetail id="a/b" onBack={vi.fn()} onDownload={vi.fn()} />);
    expect(await screen.findByText("Hugging Face could not be reached.")).toBeInTheDocument();
  });
});
