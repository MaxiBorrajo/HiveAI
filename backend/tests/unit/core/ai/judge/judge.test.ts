import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildJudgePrompt,
  gradeRun,
  parseJudgeAnswer,
} from "../../../../../core/ai/judge/judge.ts";

const ref = { provider: "ollama", model: "judge-model" } as const;
const input = { input: { q: "hi" }, output: "hello", rubric: "Be polite" };

Deno.test("parseJudgeAnswer reads the last score and reason", () => {
  const out = parseJudgeAnswer("thinking SCORE: 3\nSCORE: 8\nREASON: polite and short");
  assertEquals(out, { ok: true, score: 8, reasoning: "polite and short" });
});

Deno.test("parseJudgeAnswer rejects a missing or out-of-range score", () => {
  assertEquals(parseJudgeAnswer("no verdict").ok, false);
  assertEquals(parseJudgeAnswer("SCORE: 11\nREASON: x").ok, false);
  assertEquals(parseJudgeAnswer("SCORE: 0\nREASON: x").ok, false);
});

Deno.test("buildJudgePrompt includes the rubric and the reference when given", () => {
  const prompt = buildJudgePrompt({ ...input, reference: "Hi there" });
  assertStringIncludes(prompt, "Be polite");
  assertStringIncludes(prompt, "Hi there");
  assertEquals(buildJudgePrompt(input).includes("Reference answer"), false);
});

Deno.test("gradeRun returns the parsed grade", async () => {
  const out = await gradeRun(ref, input, {
    runAgent: () => Promise.resolve("SCORE: 7\nREASON: fine"),
  });
  assertEquals(out, { ok: true, score: 7, reasoning: "fine" });
});

Deno.test("gradeRun never throws when the judge fails", async () => {
  const out = await gradeRun(ref, input, {
    runAgent: () => Promise.reject(new Error("connection refused")),
  });
  assertEquals(out.ok, false);
  if (!out.ok) assertStringIncludes(out.error, "connection refused");
});

Deno.test("gradeRun reports a format error as a failure, not a low score", async () => {
  const out = await gradeRun(ref, input, {
    runAgent: () => Promise.resolve("I refuse to grade this."),
  });
  assertEquals(out.ok, false);
});
