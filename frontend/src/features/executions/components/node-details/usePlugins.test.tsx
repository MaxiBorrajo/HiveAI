import { describe, expect, test, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const { getPlugins } = vi.hoisted(() => ({ getPlugins: vi.fn() }));
vi.mock("@/features/plugins/api/getPlugins", () => ({ getPlugins }));

import { useInstalledPlugins } from "./usePlugins";

const p = (name: string, active: boolean) => ({ id: name, name, description: "", active });

describe("useInstalledPlugins", () => {
  test("returns every plugin, not just the ones active for the chat", async () => {
    getPlugins.mockResolvedValue({ success: true, data: [p("a", true), p("b", false)] });
    const { result } = renderHook(() => useInstalledPlugins(true));
    await waitFor(() => expect(result.current.map((x) => x.name)).toEqual(["a", "b"]));
  });

  test("asks nothing until it is enabled", () => {
    getPlugins.mockClear();
    renderHook(() => useInstalledPlugins(false));
    expect(getPlugins).not.toHaveBeenCalled();
  });
});
