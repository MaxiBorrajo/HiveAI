import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Plugin } from "@/features/plugins/types";
import type { GraphNode } from "../../types";

vi.mock("@/features/models/ModelsContext", () => ({
  useModels: () => ({ optionGroups: [] }),
}));
vi.mock("@/features/models/DownloadsContext", () => ({
  useDownloads: () => ({ requestDownload: vi.fn() }),
}));
const PLUGINS: Plugin[] = [
  { id: "web_search", name: "web_search", description: "", active: true },
  { id: "file_read", name: "file_read", description: "", active: true },
];
vi.mock("./usePlugins", () => ({ useInstalledPlugins: () => PLUGINS }));

import { BulkEditPanel } from "./BulkEditPanel";

const llm = (id: string, config: Record<string, any>): GraphNode => ({
  id,
  name: id.toUpperCase(),
  type: "llm",
  config: { systemPrompt: `prompt of ${id}`, outputKey: `${id}_out`, ...config },
});

function renderPanel(nodes: GraphNode[]) {
  const onApply = vi.fn();
  const onDelete = vi.fn();
  render(
    <BulkEditPanel nodes={nodes} canEdit onApply={onApply} onDelete={onDelete} onClearSelection={vi.fn()} />,
  );
  return { onApply, onDelete };
}

describe("BulkEditPanel", () => {
  test("nodes on different models keep them until you pick one for all", async () => {
    const { onApply } = renderPanel([
      llm("a", { model: "qwen3:8b" }),
      llm("b", { model: "llama3.2" }),
    ]);

    const provider = screen.getAllByRole("combobox")[0];
    expect(provider).toHaveDisplayValue("Keep each node's model");
    expect(screen.getByRole("button", { name: "Apply to 2" })).toBeDisabled();

    await userEvent.selectOptions(provider, "Default model");
    await userEvent.click(screen.getByRole("button", { name: "Apply to 2" }));
    expect(onApply).toHaveBeenCalledWith(["a", "b"], { model: null });
  });

  test("a tool only some nodes have shows as partial, and one click equips it on all", async () => {
    const { onApply } = renderPanel([
      llm("a", { plugins: ["web_search"] }),
      llm("b", { plugins: [] }),
    ]);

    const webSearch = screen.getByRole("checkbox", { name: "web_search" }) as HTMLInputElement;
    expect(webSearch.indeterminate).toBe(true);
    expect(screen.getByRole("checkbox", { name: "file_read" })).not.toBeChecked();

    await userEvent.click(webSearch);
    expect(webSearch.indeterminate).toBe(false);
    expect(webSearch).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Apply to 2" }));
    expect(onApply).toHaveBeenCalledWith(["a", "b"], { plugins: { web_search: true } });
  });

  test("max tokens: a shared value is shown, a new one goes to every node", async () => {
    const { onApply } = renderPanel([llm("a", { maxTokens: 300 }), llm("b", { maxTokens: 300 })]);

    const input = screen.getByRole("spinbutton");
    expect(input).toHaveValue(300);
    await userEvent.clear(input);
    await userEvent.type(input, "900");
    await userEvent.click(screen.getByRole("button", { name: "Apply to 2" }));
    expect(onApply).toHaveBeenCalledWith(["a", "b"], { maxTokens: 900 });
  });

  test("only LLM nodes are changed; the rest can still be deleted together", async () => {
    const condition: GraphNode = { id: "check", name: "Check", type: "condition", config: {} };
    const { onApply, onDelete } = renderPanel([llm("a", {}), llm("b", {}), condition]);

    expect(screen.getByText("3 nodes selected")).toBeInTheDocument();
    expect(screen.getByText(/the other 1 stay as they are/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "file_read" }));
    await userEvent.click(screen.getByRole("button", { name: "Apply to 2" }));
    expect(onApply).toHaveBeenCalledWith(["a", "b"], { plugins: { file_read: true } });

    await userEvent.click(screen.getByRole("button", { name: /Delete 3/ }));
    expect(onDelete).toHaveBeenCalledWith(["a", "b", "check"]);
  });

  test("Reset drops the pending changes", async () => {
    renderPanel([llm("a", {}), llm("b", {})]);
    await userEvent.click(screen.getByRole("checkbox", { name: "web_search" }));
    expect(screen.getByRole("checkbox", { name: "web_search" })).toBeChecked();

    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByRole("checkbox", { name: "web_search" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Apply to 2" })).toBeDisabled();
  });
});
