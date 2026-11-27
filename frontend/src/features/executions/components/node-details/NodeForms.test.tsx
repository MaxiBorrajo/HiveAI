import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Plugin } from "@/features/plugins/types";

vi.mock("@/features/models/ModelsContext", () => ({
  useModels: () => ({ optionGroups: [] }),
}));
vi.mock("@/features/models/DownloadsContext", () => ({
  useDownloads: () => ({ requestDownload: vi.fn() }),
}));

import { LlmNodeForm, PluginNodeForm } from "./NodeForms";

const plugin = (over: Partial<Plugin>): Plugin => ({
  id: over.name ?? "p",
  name: "p",
  description: "",
  active: true,
  ...over,
});

// "active" is the chat's switch; the node editor must not depend on it.
const PLUGINS = [
  plugin({ name: "web_search", active: true }),
  plugin({ name: "run_shell", active: false }),
  plugin({ name: "my_import", active: false, isExternal: true }),
  plugin({ name: "running_import", active: true, isExternal: true }),
];

function renderLlm(config: Record<string, any> = {}, plugins = PLUGINS) {
  const setConfig = vi.fn();
  render(<LlmNodeForm config={config} setConfig={setConfig} stateKeys={[]} plugins={plugins} />);
  return { setConfig };
}

describe("LlmNodeForm tools", () => {
  test("offers every installed plugin, including the ones switched off for the chat", () => {
    renderLlm();
    for (const name of ["web_search", "run_shell", "my_import", "running_import"]) {
      expect(screen.getByRole("checkbox", { name: new RegExp(name) })).toBeInTheDocument();
    }
  });

  test("an inactive built-in plugin can be equipped like any other", async () => {
    const { setConfig } = renderLlm({ plugins: [] });
    await userEvent.click(screen.getByRole("checkbox", { name: /run_shell/ }));
    expect(setConfig).toHaveBeenCalledWith(expect.objectContaining({ plugins: ["run_shell"] }));
  });

  test("only an imported plugin that is off says it must be activated", () => {
    renderLlm();
    const notes = screen.getAllByText(/activate it in Plugins to run/);
    expect(notes).toHaveLength(1);
    expect(screen.getByRole("checkbox", { name: /^my_import/ }).closest("label"))
      .toHaveTextContent(/activate it in Plugins to run/);
    expect(screen.getByRole("checkbox", { name: /run_shell/ }).closest("label"))
      .not.toHaveTextContent(/activate/);
  });

  test("with nothing installed it says so", () => {
    renderLlm({}, []);
    expect(screen.getByText("No plugins installed.")).toBeInTheDocument();
  });
});

describe("PluginNodeForm", () => {
  test("can pick a plugin that is switched off for the chat", () => {
    render(
      <PluginNodeForm
        config={{ pluginId: "run_shell", inputMapping: {} }}
        setConfig={vi.fn()}
        stateKeys={[]}
        plugins={[plugin({ name: "run_shell", active: false, parameters: [{ name: "command", required: true }] })]}
      />,
    );
    expect(screen.getByText("command *")).toBeInTheDocument();
  });
});
