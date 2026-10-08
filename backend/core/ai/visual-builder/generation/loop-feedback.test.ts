import { assertEquals } from "@std/assert";
import { wireLoopFeedback } from "./loop-feedback.ts";
import type { LangGraphAbstraction } from "../types.ts";

const llm = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  type: "llm" as const,
  config: { outputKey: `${id}_out`, inputMapping: { plan: "plan" }, ...extra },
});

Deno.test("wireLoopFeedback - critique output reaches every LLM node of the retry cycle except the judge", () => {
  const graph: LangGraphAbstraction = {
    nodes: [
      { id: "start", name: "Start", type: "start", config: {} },
      llm("hero"),
      llm("cta"),
      llm("judge"),
      { id: "check", name: "Check", type: "condition", config: {} },
      llm("critique", { outputKey: "critique" }),
      llm("assemble"),
      { id: "end", name: "End", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "hero", isConditional: false },
      { id: "e2", source: "hero", target: "cta", isConditional: false },
      { id: "e3", source: "cta", target: "judge", isConditional: false },
      { id: "e4", source: "judge", target: "check", isConditional: false },
      { id: "e5", source: "check", target: "assemble", isConditional: true, path: "true" },
      { id: "e6", source: "check", target: "critique", isConditional: true, path: "false" },
      { id: "e7", source: "critique", target: "hero", isConditional: false },
      { id: "e8", source: "assemble", target: "end", isConditional: false },
    ],
    stateSchema: { critique: { type: "string", required: false } },
  };

  const updated = wireLoopFeedback(graph).map((n) => n.id).sort();
  assertEquals(updated, ["cta", "hero"]);
  const hero = graph.nodes.find((n) => n.id === "hero")!;
  assertEquals((hero.config.inputMapping as Record<string, string>).critique, "critique");
  const judge = graph.nodes.find((n) => n.id === "judge")!;
  assertEquals("critique" in (judge.config.inputMapping as object), false);
  assertEquals(graph.stateSchema.critique.default, "");
});
