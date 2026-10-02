import { assertEquals } from "@std/assert";
import { describeNeighbor } from "./prompt-helpers.ts";
import { GraphNode } from "../types.ts";

Deno.test("describeNeighbor - returns 'none' for undefined node", () => {
  assertEquals(describeNeighbor(undefined, new Map()), "none");
});

Deno.test("describeNeighbor - includes role, outputKey and tools when present", () => {
  const node: GraphNode = {
    id: "n1",
    name: "Fetch",
    type: "llm",
    config: { outputKey: "result", plugins: ["web-search"] },
  };
  const descriptions = new Map([["n1", "fetches stuff"]]);
  const desc = describeNeighbor(node, descriptions);
  assertEquals(
    desc,
    `"Fetch" (type: llm, role: "fetches stuff", outputKey: "result", tools: [web-search])`,
  );
});
