import { assertEquals, assertMatch, assertRejects, assertStrictEquals } from "@std/assert";
import {
  isSameModel,
  JudgeFormatError,
  judgeWithLlm,
  parseJudgeResponse,
  PASS_SCORE_THRESHOLD,
  type JudgeModelFactory,
} from "../../../tests/llm-eval/judge.ts";

Deno.test("parseJudgeResponse - parses a well-formed response", () => {
  const text = "SCORE: 85\nVERDICT: PASS\nREASON: Covers all key facts concisely.";
  const parsed = parseJudgeResponse(text);
  assertEquals(parsed, {
    score: 85,
    pass: true,
    reasoning: "Covers all key facts concisely.",
  });
});

Deno.test("parseJudgeResponse - a FAIL verdict with a low score parses correctly", () => {
  const text = "SCORE: 20\nVERDICT: FAIL\nREASON: Missed the deforestation point entirely.";
  const parsed = parseJudgeResponse(text);
  assertEquals(parsed?.pass, false);
  assertEquals(parsed?.score, 20);
});

Deno.test("parseJudgeResponse - clamps an out-of-range score into [0, 100]", () => {
  const over = parseJudgeResponse("SCORE: 150\nVERDICT: PASS\nREASON: ok");
  assertEquals(over?.score, 100);
});

Deno.test("parseJudgeResponse - missing REASON still parses, with a fallback reasoning string", () => {
  const parsed = parseJudgeResponse("SCORE: 90\nVERDICT: PASS");
  assertEquals(parsed?.score, 90);
  assertEquals(parsed?.reasoning, "(no reason given)");
});

Deno.test("parseJudgeResponse - missing SCORE fails to parse (format error)", () => {
  const parsed = parseJudgeResponse("VERDICT: PASS\nREASON: looks fine");
  assertStrictEquals(parsed, undefined);
});

Deno.test("parseJudgeResponse - only SCORE is required; pass comes from the threshold", () => {
  const parsed = parseJudgeResponse("SCORE: 80\nREASON: looks fine");
  assertEquals(parsed, { score: 80, pass: true, reasoning: "looks fine" });
});

Deno.test("parseJudgeResponse - a judge's own VERDICT can't override the score threshold", () => {
  const lenient = parseJudgeResponse("SCORE: 40\nVERDICT: PASS\nREASON: mostly ok");
  assertEquals(lenient?.pass, false);
  const atThreshold = parseJudgeResponse(`SCORE: ${PASS_SCORE_THRESHOLD}\nVERDICT: FAIL\nREASON: ok`);
  assertEquals(atThreshold?.pass, true);
  const below = parseJudgeResponse(`SCORE: ${PASS_SCORE_THRESHOLD - 1}\nREASON: close`);
  assertEquals(below?.pass, false);
});

/** A stand-in for the judge model: answers every call with `reply` (or throws it). */
function fakeJudge(reply: string | Error) {
  const prompts: string[] = [];
  const factory: JudgeModelFactory = () =>
    Promise.resolve({
      invoke: (messages) => {
        prompts.push(messages.map((m) => String(m.content)).join("\n---\n"));
        return reply instanceof Error ? Promise.reject(reply) : Promise.resolve({ content: reply });
      },
    });
  return { factory, prompts };
}

const JUDGE_REF = { provider: "ollama" as const, model: "lfm2.5" };

Deno.test("judgeWithLlm - grades with a simulated judge and returns score and justification", async () => {
  const { factory, prompts } = fakeJudge("SCORE: 88\nREASON: Accurate and concise.");
  const result = await judgeWithLlm(
    JUDGE_REF,
    "Summarize this",
    "A short summary.",
    { rubric: "Keeps only key facts.", referenceAnswer: "The reference." },
    factory,
  );
  assertEquals(result, { score: 88, pass: true, reasoning: "Accurate and concise." });
  assertMatch(prompts[0], /Rubric for a PASS: Keeps only key facts\./);
  assertMatch(prompts[0], /Reference answer: The reference\./);
  assertMatch(prompts[0], /Agent output:\nA short summary\./);
});

Deno.test("judgeWithLlm - ignores a SCORE mentioned inside a <think> block", async () => {
  const { factory } = fakeJudge("<think>Maybe SCORE: 100? No.</think>\nSCORE: 30\nREASON: Misses facts.");
  const result = await judgeWithLlm(JUDGE_REF, "q", "out", { rubric: "r" }, factory);
  assertEquals(result.score, 30);
  assertEquals(result.pass, false);
});

Deno.test("judgeWithLlm - an invalid-format answer throws JudgeFormatError (recorded as unjudged)", async () => {
  const { factory } = fakeJudge("Looks great to me!");
  await assertRejects(
    () => judgeWithLlm(JUDGE_REF, "q", "out", { rubric: "r" }, factory),
    JudgeFormatError,
  );
});

Deno.test("judgeWithLlm - a failing judge model propagates its error to the caller", async () => {
  const { factory } = fakeJudge(new Error("connection refused"));
  await assertRejects(
    () => judgeWithLlm(JUDGE_REF, "q", "out", { rubric: "r" }, factory),
    Error,
    "connection refused",
  );
});

Deno.test("judgeWithLlm - requires a rubric or a reference answer", async () => {
  const { factory } = fakeJudge("SCORE: 90");
  await assertRejects(() => judgeWithLlm(JUDGE_REF, "q", "out", {}, factory), Error, "rubric or a referenceAnswer");
});

Deno.test("isSameModel - compares provider and model, not the key", () => {
  assertEquals(isSameModel({ provider: "ollama", model: "qwen3:8b" }, { provider: "ollama", model: "qwen3:8b" }), true);
  assertEquals(
    isSameModel({ provider: "anthropic", model: "x", keyId: "a" }, { provider: "anthropic", model: "x", keyId: "b" }),
    true,
  );
  assertEquals(isSameModel({ provider: "ollama", model: "qwen3:8b" }, { provider: "ollama", model: "lfm2.5" }), false);
});

Deno.test("parseJudgeResponse - a model that ignores the format entirely fails to parse", () => {
  const parsed = parseJudgeResponse(
    "Sure! I think this summary is pretty good overall, nice work.",
  );
  assertStrictEquals(parsed, undefined);
});

Deno.test("parseJudgeResponse - is case-insensitive on VERDICT and label casing", () => {
  const parsed = parseJudgeResponse("score: 60\nverdict: fail\nreason: partial coverage.");
  assertEquals(parsed?.score, 60);
  assertEquals(parsed?.pass, false);
});
