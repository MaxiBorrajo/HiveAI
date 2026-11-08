import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMockApiClient, ok } from "@/test-utils/mockApiClient";

const { mockApiClient } = vi.hoisted(() => ({
  mockApiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), request: vi.fn() },
}));

vi.mock("@/lib/apiClient", () => ({ apiClient: mockApiClient }));
vi.mock("@/features/models/DownloadsContext", () => ({
  useDownloads: () => ({
    downloads: [],
    start: vi.fn(),
    cancel: vi.fn(),
    retry: vi.fn(),
    requestedName: null,
    clearRequest: vi.fn(),
  }),
}));

import { Dialog } from "@/components/ui/dialog";
import { ExploreModelsModal } from "./ExploreModelsModal";
import { ModelListView } from "./ModelListView";
import { ModelMenu } from "./ModelMenu";

beforeEach(() => {
  vi.clearAllMocks();
  const real = createMockApiClient([
    { method: "get", match: "/api/hardware", handler: () => ok({
      profile: { totalMemBytes: 8e9, availableMemBytes: 4e9, gpu: { usable: false, unifiedMemory: false } },
      context: { nCtx: 8192, pluginTokens: 0, kvCacheType: "f16" },
      plugins: [], noToolModelFits: false, cloudSuggestion: null, hasCloudKey: false,
    }) },
    { method: "get", match: "/api/model-discovery/search", handler: () => ok({ offline: false, items: [] }) },
  ]);
  mockApiClient.get.mockImplementation(real.get);
});

describe("Explore models modal", () => {
  test("opens with hardware summary and the search box", async () => {
    render(<ExploreModelsModal isOpen onOpenChange={vi.fn()} />);
    expect(screen.getByTestId("explore-models-title")).toBeInTheDocument();
    expect(await screen.findByTestId("hardware-memory")).toHaveTextContent(/No usable GPU/);
    expect(screen.getByTestId("model-search-input")).toBeInTheDocument();
  });

  test("renders nothing when closed", () => {
    render(<ExploreModelsModal isOpen={false} onOpenChange={vi.fn()} />);
    expect(screen.queryByTestId("explore-models-title")).not.toBeInTheDocument();
  });
});

describe("Manage models", () => {
  test("no longer has a Download tab", () => {
    render(
      <Dialog open>
        <ModelListView
          models={[]}
          groups={[]}
          current={{ model: "", provider: "ollama", keyId: "" }}
          onChangeModel={vi.fn()}
          onSelectModel={vi.fn()}
          onDeleteModel={vi.fn()}
        />
      </Dialog>,
    );
    expect(screen.getByTestId("manage-models-title")).toBeInTheDocument();
    expect(screen.getByTestId("model-provider-tabs")).not.toHaveTextContent(/Download/);
  });
});

describe("Model menu", () => {
  test("the compass icon opens the explore modal", async () => {
    const onOpenExplore = vi.fn();
    render(
      <ModelMenu
        groups={[]}
        current={{ model: "qwen3:8b", provider: "ollama", keyId: "" }}
        onChangeModel={vi.fn()}
        onOpenManage={vi.fn()}
        onOpenExplore={onOpenExplore}
        onOpenKeys={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByTestId("model-menu-trigger"));
    await userEvent.click(await screen.findByTestId("model-menu-explore"));
    expect(onOpenExplore).toHaveBeenCalled();
  });

  test("shows the number of active downloads on the icon", async () => {
    render(
      <ModelMenu
        groups={[]}
        current={{ model: "qwen3:8b", provider: "ollama", keyId: "" }}
        onChangeModel={vi.fn()}
        onOpenManage={vi.fn()}
        onOpenExplore={vi.fn()}
        activeDownloads={2}
        onOpenKeys={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByTestId("model-menu-trigger"));
    expect(await screen.findByTestId("model-menu-active-downloads")).toHaveTextContent("2");
  });
});
