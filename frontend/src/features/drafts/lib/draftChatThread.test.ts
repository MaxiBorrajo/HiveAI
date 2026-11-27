import { describe, expect, test } from "vitest";
import {
  addStep,
  addToolCall,
  describeToolInput,
  failTurn,
  finishTurn,
  hasChanges,
  resolveToolCall,
  startTurn,
} from "./draftChatThread";

describe("draft chat thread", () => {
  test("a tool call is resolved in order and keeps its output", () => {
    let turn = startTurn("t", "make a plugin", "old");
    turn = addToolCall(turn, "web_search", { query: "slack webhook" });
    turn = addToolCall(turn, "web_search", { query: "slack blocks" });
    turn = resolveToolCall(turn, "web_search", true, "found it");

    expect(turn.steps[0].tool).toMatchObject({ status: "ok", output: "found it" });
    expect(turn.steps[1].tool?.status).toBe("running");
  });

  test("resolving an unknown tool leaves the turn unchanged", () => {
    const turn = addStep(startTurn("t", "p", ""), "thinking", "hm");
    expect(resolveToolCall(turn, "nope", true)).toBe(turn);
  });

  test("finish and fail set the final state; changes are detected", () => {
    const turn = startTurn("t", "p", "a");
    const done = finishTurn(turn, "Added it", "b");
    expect(done.status).toBe("done");
    expect(hasChanges(done)).toBe(true);
    expect(hasChanges(finishTurn(turn, undefined, "a"))).toBe(false);
    expect(failTurn(turn, "boom")).toMatchObject({ status: "error", error: "boom" });
  });

  test("describeToolInput shows the first text argument, trimmed", () => {
    expect(describeToolInput({ query: "slack webhook" })).toBe("slack webhook");
    expect(describeToolInput({ n: 3 })).toBe("");
    expect(describeToolInput({ q: "x".repeat(100) }, 10)).toBe("xxxxxxxxx…");
  });
});
