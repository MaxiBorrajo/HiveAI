import { assertEquals } from "@std/assert";
import {
  classifyByHeuristics,
  classifyTask,
} from "../../../../modules/model-recommendations/lib/classify-task.ts";

const REF = { provider: "ollama", model: "qwen3:8b" } as const;

Deno.test("heuristics - an attached image means vision", () => {
  assertEquals(classifyByHeuristics({ text: "qué es esto?", hasImage: true }), "vision");
});

Deno.test("heuristics - code fences and code vocabulary mean code", () => {
  assertEquals(classifyByHeuristics({ text: "arreglá esto:\n```ts\nconst a = 1\n```" }), "code");
  assertEquals(classifyByHeuristics({ text: "I get an exception with this python function, can you debug it" }), "code");
});

Deno.test("heuristics - summarization in Spanish and English", () => {
  assertEquals(classifyByHeuristics({ text: "Resumime este texto por favor" }), "summarization");
  assertEquals(classifyByHeuristics({ text: "give me a tl;dr of this article" }), "summarization");
});

Deno.test("heuristics - an attached document or spreadsheet words mean documents_data", () => {
  assertEquals(classifyByHeuristics({ text: "qué ves acá", hasDocument: true }), "documents_data");
  assertEquals(classifyByHeuristics({ text: "analizá este csv" }), "documents_data");
});

Deno.test("heuristics - weak or tied signals give no answer", () => {
  assertEquals(classifyByHeuristics({ text: "hola, cómo estás?" }), null);
  assertEquals(classifyByHeuristics({ text: "debug this csv" }), null); // code (2) ties documents_data (2)
  assertEquals(classifyByHeuristics({ text: "I have a bug" }), null); // a single weak hint is not enough
});

Deno.test("heuristics - a clear winner beats a weak runner-up", () => {
  assertEquals(classifyByHeuristics({ text: "resumí este código" }), "summarization");
});

Deno.test("classifyTask - heuristics decide without calling the model", async () => {
  let calls = 0;
  const r = await classifyTask({ text: "resumime esto" }, REF, { llm: () => (calls++, Promise.resolve("chat")) });
  assertEquals(r, { task: "summarization", source: "heuristic" });
  assertEquals(calls, 0);
});

Deno.test("classifyTask - no signal on a long message falls back to the small model", async () => {
  const text = "necesito ayuda para decidir cómo organizar mi semana de trabajo con tantas cosas pendientes";
  assertEquals(await classifyTask({ text }, REF, { llm: () => Promise.resolve("reasoning") }), {
    task: "reasoning",
    source: "llm",
  });
});

Deno.test("classifyTask - a short message with no signal costs nothing and returns null", async () => {
  let calls = 0;
  const r = await classifyTask({ text: "hola" }, REF, { llm: () => (calls++, Promise.resolve("chat")) });
  assertEquals(r, null);
  assertEquals(calls, 0);
});

Deno.test("classifyTask - when the small model fails there is no classification", async () => {
  const text = "necesito ayuda para decidir cómo organizar mi semana de trabajo con tantas cosas pendientes";
  assertEquals(await classifyTask({ text }, REF, { llm: () => Promise.resolve(null) }), null);
});
