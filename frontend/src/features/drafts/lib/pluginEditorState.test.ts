import { describe, expect, test } from "vitest";
import {
  buildFixPrompt,
  finishToolRun,
  isDirty,
  needsConfiguration,
  startToolRun,
} from "./pluginEditorState";

describe("plugin editor state", () => {
  test("only edit mode with different content is dirty", () => {
    expect(isDirty("edit", "a", "a")).toBe(false);
    expect(isDirty("edit", "b", "a")).toBe(true);
    expect(isDirty("view", "b", "a")).toBe(false);
  });

  test("the fix prompt lists every issue", () => {
    const prompt = buildFixPrompt(["bad import", "needs 9 tests"]);
    expect(prompt).toContain("smallest possible change");
    expect(prompt).toContain("- bad import\n- needs 9 tests");
  });

  test("tool runs are closed in order and unknown results are ignored", () => {
    let runs = startToolRun([], "pg", { sql: "select 1" });
    runs = startToolRun(runs, "pg", { sql: "select 2" });
    runs = finishToolRun(runs, "pg", true, "ok");
    expect(runs.map((r) => r.status)).toEqual(["ok", "running"]);
    expect(finishToolRun(runs, "other", true)).toBe(runs);
  });

  test("configuration is needed only when fields exist and none is set", () => {
    expect(needsConfiguration(null)).toBe(false);
    expect(needsConfiguration([])).toBe(false);
    expect(needsConfiguration([{ masked: null, value: null }])).toBe(true);
    expect(
      needsConfiguration([
        { masked: "••••x", value: null },
        { masked: null, value: null },
      ]),
    ).toBe(false);
  });
});
