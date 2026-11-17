import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PluginConfigDialog } from "./PluginConfigDialog";
import type { PluginConfigApi } from "../api/pluginConfig";
import type { PluginConfigFieldValue } from "../types";

function fakeApi(fields: PluginConfigFieldValue[]) {
  const values = new Map(fields.map((f) => [f.key, f.value]));
  const api = {
    get: vi.fn(async () => ({
      success: true,
      data: fields.map((f) => ({ ...f, value: values.get(f.key) ?? null })),
    })),
    set: vi.fn(async (_plugin: string, key: string, value: string) => {
      values.set(key, value);
      return { success: true };
    }),
    remove: vi.fn(async () => ({ success: true })),
  };
  return api as unknown as PluginConfigApi & typeof api;
}

const provider: PluginConfigFieldValue = {
  key: "provider",
  label: "Provider",
  secret: false,
  masked: null,
  value: "gemini",
  options: [
    { value: "gemini", label: "Google Gemini (cloud)" },
    { value: "ollama", label: "Ollama (local)" },
  ],
  description: "Cloud providers need an API key; Ollama runs on this computer.",
};

const baseUrl: PluginConfigFieldValue = {
  key: "baseUrl",
  label: "Server URL",
  secret: false,
  masked: null,
  value: null,
  placeholder: "http://localhost:11434/v1",
};

describe("PluginConfigDialog", () => {
  it("shows a field with choices as a list, with its description", async () => {
    render(
      <PluginConfigDialog
        pluginName="generate_image"
        onOpenChange={() => {}}
        api={fakeApi([provider])}
      />,
    );

    expect(await screen.findByText("Google Gemini (cloud)")).toBeInTheDocument();
    expect(
      screen.getByText("Cloud providers need an API key; Ollama runs on this computer."),
    ).toBeInTheDocument();
    // Picking saves right away: there is nothing to confirm.
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("saves a choice as soon as it is picked", async () => {
    const api = fakeApi([provider]);
    render(
      <PluginConfigDialog pluginName="generate_image" onOpenChange={() => {}} api={api} />,
    );

    // The list reacts to real pointer events, which fireEvent does not send.
    const user = userEvent.setup();
    await user.click(await screen.findByRole("combobox", { name: "Provider" }));
    await user.click(await screen.findByRole("option", { name: "Ollama (local)" }));

    await waitFor(() =>
      expect(api.set).toHaveBeenCalledWith("generate_image", "provider", "ollama"),
    );
  });

  it("a plain value stays visible after saving, and the placeholder hints the default", async () => {
    const api = fakeApi([baseUrl]);
    render(
      <PluginConfigDialog pluginName="generate_image" onOpenChange={() => {}} api={api} />,
    );

    const input = await screen.findByPlaceholderText("http://localhost:11434/v1");
    fireEvent.change(input, { target: { value: "http://localhost:9000/v1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.set).toHaveBeenCalledWith("generate_image", "baseUrl", "http://localhost:9000/v1"),
    );
    await waitFor(() => expect(input).toHaveValue("http://localhost:9000/v1"));
  });
});
