import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMockApiClient, ok, type MockRoute } from "@/test-utils/mockApiClient";
import { testPlugin } from "../__tests__/fixtures";
import type { Plugin } from "@/features/plugins/types";

/**
 * This whole suite exercises the real plugin-management UI (PluginsManager
 * -> PluginsMenu/PluginsModal/PluginListView/DraftListView) against a fake
 * backend — no network, no Ollama. Every call this component tree makes
 * goes through apiClient, so mocking that one module is enough to control
 * the whole flow deterministically.
 */
const { mockApiClient, routesRef } = vi.hoisted(() => {
  const routesRef: { current: import("@/test-utils/mockApiClient").MockRoute[] } = {
    current: [],
  };
  return {
    routesRef,
    mockApiClient: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      request: vi.fn(),
    },
  };
});

vi.mock("@/lib/apiClient", () => ({ apiClient: mockApiClient }));

function setRoutes(routes: MockRoute[]) {
  routesRef.current = routes;
  const real = createMockApiClient(routes);
  mockApiClient.get.mockImplementation(real.get);
  mockApiClient.post.mockImplementation(real.post);
  mockApiClient.put.mockImplementation(real.put);
  mockApiClient.patch.mockImplementation(real.patch);
  mockApiClient.delete.mockImplementation(real.delete);
  mockApiClient.request.mockImplementation(real.request);
}

function baseRoutes(plugins: Plugin[]): MockRoute[] {
  return [
    { method: "get", match: "/api/plugins", handler: () => ok(plugins) },
    { method: "get", match: "/api/models", handler: () => ok([]) },
    { method: "get", match: "/api/models/options", handler: () => ok([]) },
    {
      method: "get",
      match: "/api/models/current",
      handler: () => ok({ model: "", provider: "ollama", keyId: "" }),
    },
    {
      method: "get",
      match: "/api/models/embedding-status",
      handler: () => ok({ available: true, model: "nomic-embed-text" }),
    },
    { method: "get", match: "/api/drafts", handler: () => ok({ drafts: [] }) },
  ];
}

async function renderPluginsManager(initialPlugins: Plugin[] = []) {
  setRoutes(baseRoutes(initialPlugins));

  const { ModelsProvider } = await import("@/features/models/ModelsContext");
  const { DraftEditorProvider } = await import("@/features/drafts/DraftEditorContext");
  const { PluginsManager } = await import("./PluginsManager");

  render(
    <ModelsProvider>
      <DraftEditorProvider>
        <PluginsManager />
      </DraftEditorProvider>
    </ModelsProvider>,
  );

  // Opens the "Plugins" dropdown trigger (the swarm icon in the sidebar).
  await userEvent.click(screen.getByTitle("Plugins"));
}

async function openManageDialog() {
  await userEvent.click(await screen.findByText("Manage Plugins..."));
  await screen.findByText("Manage Plugins");
}

describe("Plugins modal — list, install, invoke, uninstall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("lists the registered plugins", async () => {
    await renderPluginsManager([testPlugin]);
    await openManageDialog();

    expect(await screen.findByText(testPlugin.name)).toBeInTheDocument();
    expect(screen.getByText(testPlugin.description)).toBeInTheDocument();
  });

  test("shows an empty state when there are no plugins registered", async () => {
    await renderPluginsManager([]);
    await openManageDialog();

    expect(await screen.findByText("No plugins registered.")).toBeInTheDocument();
  });

  test("installing (registering) a plugin: importing refreshes the list with the new plugin", async () => {
    const routes = baseRoutes([]);
    const installedPlugin: Plugin = { ...testPlugin, active: true };
    let registered = false;

    routes.push({
      method: "post",
      match: "/api/plugins/import",
      handler: () => {
        registered = true;
        return ok({ name: installedPlugin.name, description: installedPlugin.description });
      },
    });
    // After import, PluginsManager calls refreshPlugins() -> GET /api/plugins again.
    routes[0] = {
      method: "get",
      match: "/api/plugins",
      handler: () => ok(registered ? [installedPlugin] : []),
    };
    setRoutes(routes);

    const { ModelsProvider } = await import("@/features/models/ModelsContext");
    const { DraftEditorProvider } = await import("@/features/drafts/DraftEditorContext");
    const { PluginsManager } = await import("./PluginsManager");
    render(
      <ModelsProvider>
        <DraftEditorProvider>
          <PluginsManager />
        </DraftEditorProvider>
      </ModelsProvider>,
    );
    await userEvent.click(screen.getByTitle("Plugins"));
    await openManageDialog();

    expect(screen.queryByText(installedPlugin.name)).not.toBeInTheDocument();

    const file = new File(["export default {}"], "index.ts", {
      type: "text/plain",
    });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, file);

    await waitFor(() => {
      expect(mockApiClient.post).toHaveBeenCalledWith(
        "/api/plugins/import",
        expect.anything(),
      );
    });
    expect(await screen.findByText(installedPlugin.name)).toBeInTheDocument();
  });

  test("toggling a plugin active calls the activate endpoint", async () => {
    await renderPluginsManager([testPlugin]);
    await openManageDialog();

    const row = (await screen.findByText(testPlugin.name)).closest(
      "div.flex.flex-col.gap-2",
    ) as HTMLElement;
    const toggle = within(row).getByRole("checkbox");
    expect(toggle).not.toBeChecked();

    await userEvent.click(toggle);

    await waitFor(() => {
      expect(mockApiClient.post).toHaveBeenCalledWith(
        `/api/plugins/${testPlugin.name}/activate`,
      );
    });
  });

  test("uninstalling an external plugin removes it from the list", async () => {
    const routes = baseRoutes([testPlugin]);
    let removed = false;
    routes.push({
      method: "delete",
      match: `/api/plugins/${testPlugin.name}`,
      handler: () => {
        removed = true;
        return ok(undefined);
      },
    });
    routes[0] = {
      method: "get",
      match: "/api/plugins",
      handler: () => ok(removed ? [] : [testPlugin]),
    };
    setRoutes(routes);

    const { ModelsProvider } = await import("@/features/models/ModelsContext");
    const { DraftEditorProvider } = await import("@/features/drafts/DraftEditorContext");
    const { PluginsManager } = await import("./PluginsManager");
    render(
      <ModelsProvider>
        <DraftEditorProvider>
          <PluginsManager />
        </DraftEditorProvider>
      </ModelsProvider>,
    );
    await userEvent.click(screen.getByTitle("Plugins"));
    await openManageDialog();

    await screen.findByText(testPlugin.name);
    const row = screen.getByText(testPlugin.name).closest(
      "div.flex.flex-col.gap-2",
    ) as HTMLElement;
    const removeButton = within(row).getAllByRole("button").find((btn) =>
      btn.querySelector("svg.lucide-trash2"),
    )!;

    await userEvent.click(removeButton);

    await waitFor(() => {
      expect(mockApiClient.delete).toHaveBeenCalledWith(
        `/api/plugins/${testPlugin.name}`,
      );
    });
    await waitFor(() => {
      expect(screen.queryByText(testPlugin.name)).not.toBeInTheDocument();
    });
  });
});
