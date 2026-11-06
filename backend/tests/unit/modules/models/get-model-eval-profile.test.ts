import { assertEquals, assertMatch } from "@std/assert";
import { join } from "@std/path";
import {
  buildProfileExportFile,
  fetchModelEvalProfile,
  handleExportEvalProfile,
  handleStartEvalRun,
  parseEvalRunRequest,
} from "../../../../modules/models/use-cases/get-model-eval-profile.ts";

/**
 * Every test works in its own temp eval dir (HIVEAI_EVAL_DIR), so nothing
 * here can ever read or delete a real profile under ~/.hiveai.
 */
async function withEvalDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir();
  const previous = Deno.env.get("HIVEAI_EVAL_DIR");
  Deno.env.set("HIVEAI_EVAL_DIR", dir);
  try {
    await run(dir);
  } finally {
    if (previous === undefined) Deno.env.delete("HIVEAI_EVAL_DIR");
    else Deno.env.set("HIVEAI_EVAL_DIR", previous);
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

async function writeProfile(dir: string, fileSafe: string, profile: unknown) {
  await Deno.mkdir(join(dir, "profiles"), { recursive: true });
  await Deno.writeTextFile(join(dir, "profiles", `${fileSafe}.json`), JSON.stringify(profile));
}

const SAMPLE_METRIC = {
  category: "summarization",
  value: 0.9,
  level: "very-good" as const,
  casesGraded: 3,
  casesUnjudged: 0,
  lowConfidence: true,
  date: "2026-11-03T00:00:00.000Z",
  casesVersion: "old-case-set",
  judgeModel: "lfm2.5",
  rubricVersion: "v1",
  runId: "run-1",
  inputTokens: 100,
  outputTokens: 50,
  durationMs: 1000,
  costUsd: 0,
};

Deno.test("fetchModelEvalProfile returns an empty profile when the model was never evaluated", async () => {
  await withEvalDir(async () => {
    const { profile, status } = await fetchModelEvalProfile("__never-profiled__");
    assertEquals(profile, { model: "__never-profiled__", latest: {}, history: {} });
    assertEquals(status, {});
  });
});

Deno.test("fetchModelEvalProfile reads a saved profile and flags it stale when the case set changed", async () => {
  await withEvalDir(async (dir) => {
    const fixture = {
      model: "__fixture__",
      latest: { summarization: SAMPLE_METRIC },
      history: { summarization: [SAMPLE_METRIC] },
    };
    await writeProfile(dir, "__fixture__", fixture);

    const { profile, status, suites } = await fetchModelEvalProfile("__fixture__");
    assertEquals(profile, fixture);
    assertEquals(status.summarization.stale, true);
    assertMatch(status.summarization.reasons[0], /case set changed/);
    assertEquals(suites.find((s) => s.suite === "summarization")?.needsJudge, true);
  });
});

Deno.test("fetchModelEvalProfile maps a provider:model name to its file-safe path", async () => {
  await withEvalDir(async (dir) => {
    const fixture = { model: "anthropic:claude-sonnet-5", latest: {}, history: {} };
    await writeProfile(dir, "anthropic-claude-sonnet-5", fixture);
    const { profile } = await fetchModelEvalProfile("anthropic:claude-sonnet-5");
    assertEquals(profile, fixture);
  });
});

Deno.test("parseEvalRunRequest rejects a judged category without an independent judge", () => {
  const executor = { provider: "ollama", model: "qwen3:8b" };
  const noJudge = parseEvalRunRequest({ executor, suites: ["summarization"] });
  assertEquals(noJudge.request, undefined);
  assertMatch(noJudge.errors[0], /independent judge/);

  const selfJudge = parseEvalRunRequest({ executor, judge: executor, suites: ["summarization"] });
  assertMatch(selfJudge.errors[0], /same model/);

  const ok = parseEvalRunRequest({
    executor,
    judge: { provider: "ollama", model: "lfm2.5" },
    suites: ["summarization"],
  });
  assertEquals(ok.errors, []);
});

Deno.test("parseEvalRunRequest lets exact-match categories run without any judge", () => {
  const { request, errors } = parseEvalRunRequest({
    executor: { provider: "ollama", model: "qwen3:8b" },
    suites: ["routing", "execution"],
  });
  assertEquals(errors, []);
  assertEquals(request?.suites, ["routing", "execution"]);
});

Deno.test("parseEvalRunRequest rejects unknown categories and an empty selection", () => {
  const executor = { provider: "ollama", model: "qwen3:8b" };
  assertMatch(parseEvalRunRequest({ executor, suites: [] }).errors[0], /at least one/);
  assertMatch(parseEvalRunRequest({ executor, suites: ["poetry"] }).errors[0], /Unknown categories/);
});

Deno.test("handleStartEvalRun refuses a cloud run until the cost estimate is confirmed", async () => {
  await withEvalDir(async () => {
    const res = await handleStartEvalRun(
      { executor: { provider: "anthropic", model: "claude-sonnet-4-5", keyId: "k" }, suites: ["routing"] },
      {},
    );
    assertEquals(res.status, 409);
    const body = await res.json();
    assertEquals(body.data.requiresConfirmation, true);
    assertEquals(typeof body.data.totalCostUsd, "number");
  });
});

Deno.test("handleExportEvalProfile exports the profile together with its latest run's results", async () => {
  await withEvalDir(async (dir) => {
    await writeProfile(dir, "__fixture__", {
      model: "__fixture__",
      latest: { summarization: SAMPLE_METRIC },
      history: { summarization: [SAMPLE_METRIC] },
    });
    await Deno.mkdir(join(dir, "results"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "results", "run-1.jsonl"),
      JSON.stringify({
        case_id: "summarization: short input",
        category: "summarization",
        executor_model: "__fixture__",
        judge_model: "lfm2.5",
        provider: "ollama",
        pass: true,
        judged_by: "llm-judge",
        score: 90,
        detail: "Faithful and concise.",
        input_tokens: 10,
        output_tokens: 5,
        duration_ms: 100,
        run_id: "run-1",
      }) + "\n",
    );

    const md = await buildProfileExportFile("__fixture__", "md");
    assertEquals(md.filename, "__fixture__-eval-profile.md");
    assertMatch(md.body, /# Model profile: __fixture__/);
    assertMatch(md.body, /\| summarization \| 90% \| Very good \|/);
    assertMatch(md.body, /Faithful and concise\./);

    const html = await buildProfileExportFile("__fixture__", "html");
    assertMatch(html.body, /<h1>Model profile: __fixture__<\/h1>/);

    const json = JSON.parse((await buildProfileExportFile("__fixture__", "json")).body);
    assertEquals(json.runs[0].verdicts[0].score, 90);

    assertEquals((await handleExportEvalProfile("__fixture__", "pdf", {})).status, 400);
  });
});
