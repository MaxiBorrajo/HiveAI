import { ResponseBuilder } from "../../../core/api/response.ts";
import type { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import type { AppDatabase } from "../../../infrastructure/db/orm.ts";
import { ExecutionRepository } from "../../../infrastructure/db/repositories/execution-repository.ts";
import { sendMessage } from "../../chats/use-cases/send-message.ts";
import { loadRunSummaries, type RunSummary } from "./list-runs.ts";
import { MAX_GRADED_RUNS, parseJudgeRef, type GradeRunsBody } from "./grade-runs.ts";

export interface JudgeChatBody {
  message?: unknown;
  chatId?: unknown;
  historyIds?: unknown;
  judge?: GradeRunsBody["judge"];
  focus?: unknown;
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function describeModels(run: RunSummary): string {
  const orchestrator = run.usage?.orchestrator;
  const delegated = [...(run.usage?.local.models ?? []), ...(run.usage?.cloud.models ?? [])]
    .map((m) => `${m.provider}/${m.model}`);
  const parts = [
    orchestrator ? `${orchestrator.provider}/${orchestrator.model}` : null,
    ...delegated,
  ].filter(Boolean);
  return parts.length > 0 ? [...new Set(parts)].join(", ") : "unknown";
}

function describeTokens(run: RunSummary): string {
  const usage = run.usage;
  if (!usage) return "no usage recorded";
  const tokens = (bucket: { inputTokens: number | null; outputTokens: number | null }) =>
    (bucket.inputTokens ?? 0) + (bucket.outputTokens ?? 0);
  const total = tokens(usage.local) + tokens(usage.cloud);
  const time = usage.latencyMs == null ? "n/a" : `${Math.round(usage.latencyMs)} ms`;
  return `${total} tokens (local ${tokens(usage.local)}, cloud ${tokens(usage.cloud)}), ${time}`;
}

export const JUDGE_FOCUSES = ["overview", "result", "tokens", "nodes"] as const;
export type JudgeFocus = (typeof JUDGE_FOCUSES)[number];

export function parseJudgeFocus(value: unknown): JudgeFocus | null {
  return JUDGE_FOCUSES.find((focus) => focus === value) ?? null;
}

const FOCUS_HINTS: Record<JudgeFocus, string> = {
  overview: "The user is looking at the overview of the runs: judge them in general terms (result, cost, time, grades).",
  result: "The user is looking at the results of the runs: base your answer on the quality of the outputs.",
  tokens: "The user is looking at token usage by model: base your answer on tokens and models, and look up current prices with your tools if they ask about cost.",
  nodes: "The user is looking at the node-by-node breakdown: focus on which nodes and models differ between the runs.",
};

/** The comparison as plain text, so the judge can discuss it with the user. */
export function buildJudgeChatPreamble(
  executionName: string,
  runs: RunSummary[],
  focus: JudgeFocus | null = null,
): string {
  const sections = runs.map((run) => {
    const grades = run.grades.length === 0
      ? "not graded"
      : run.grades
        .map((g) =>
          g.status === "graded"
            ? `${g.score}/10 by ${g.judge.provider}/${g.judge.model} (rubric v${g.rubric.version}): ${g.reasoning}`
            : `unevaluated (judge ${g.judge.provider}/${g.judge.model} failed: ${g.error})`
        )
        .join("; ");
    return `### Run #${run.iteration} (history ${run.historyId})
- Models: ${describeModels(run)}
- Usage: ${describeTokens(run)} (prices are not recorded; look them up if asked)
- Grade: ${grades}
- Input: ${asText(run.input)}
- Result: ${asText(run.result)}`;
  });

  return `You are the judge helping the user compare ${runs.length} runs of the workflow "${executionName}".
Answer their questions about the comparison. You can use your tools, for example to look up model prices, to support your answer.${focus ? `\n${FOCUS_HINTS[focus]}` : ""}

${sections.join("\n\n")}`;
}

export async function judgeChat(
  db: AppDatabase,
  hive: HiveMicrokernel,
  executionId: number,
  body: JudgeChatBody,
  req: Request,
  headers: Record<string, string>,
): Promise<Response> {
  const fail = (message: string, status: number) =>
    ResponseBuilder.error([message], undefined, { headers, status });
  try {
    const judgeRef = parseJudgeRef(body.judge);
    if (!judgeRef) return fail("Pick a judge model.", 400);

    const historyIds = Array.isArray(body.historyIds)
      ? body.historyIds.filter((id): id is number => Number.isInteger(id))
      : [];
    if (historyIds.length === 0 || historyIds.length > MAX_GRADED_RUNS) {
      return fail(`Pick between 1 and ${MAX_GRADED_RUNS} runs.`, 400);
    }

    const execution = await new ExecutionRepository(db).findById(executionId);
    if (!execution) return fail("Execution not found", 404);

    const all = await loadRunSummaries(db, executionId);
    const runs = historyIds
      .map((id) => all.find((run) => run.historyId === id))
      .filter((run): run is RunSummary => run !== undefined);
    if (runs.length !== historyIds.length) {
      return fail("Some runs do not belong to this execution.", 400);
    }

    return await sendMessage(
      db,
      typeof body.chatId === "number" ? body.chatId : null,
      typeof body.message === "string" ? body.message : "",
      hive,
      judgeRef.model,
      req,
      headers,
      [],
      {
        modelRef: judgeRef,
        preamble: buildJudgeChatPreamble(execution.name, runs, parseJudgeFocus(body.focus)),
        title: `Judge · ${execution.name}`,
      },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return fail(`Failed to start the judge chat: ${detail}`, 500);
  }
}
