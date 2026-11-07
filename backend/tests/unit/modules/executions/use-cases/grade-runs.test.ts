import { assertEquals, assertExists } from "@std/assert";
import { initORM } from "../../../../../infrastructure/db/orm.ts";
import { ExecutionRepository } from "../../../../../infrastructure/db/repositories/execution-repository.ts";
import { gradeRuns } from "../../../../../modules/executions/use-cases/grade-runs.ts";
import { getRubric, saveRubric } from "../../../../../modules/executions/use-cases/rubric.ts";
import { listRuns } from "../../../../../modules/executions/use-cases/list-runs.ts";

const headers = {};
const judge = { provider: "ollama", model: "judge-model" };

async function setup() {
  const db = await initORM(await Deno.makeTempDir());
  const repo = new ExecutionRepository(db);
  const now = Date.now();
  const execution = await repo.create({ name: "Flow", createdAt: now, updatedAt: now });
  const other = await repo.create({ name: "Other", createdAt: now, updatedAt: now });
  const history = async (executionId: number, iteration: number, text: string) =>
    (await repo.createHistory({
      executionId,
      iteration,
      version: 1,
      createdAt: now + iteration,
      result: { result: text, finalState: {}, run: null },
    })).id;
  return {
    db,
    execution,
    a: await history(execution.id, 1, "answer A"),
    b: await history(execution.id, 2, "answer B"),
    foreign: await history(other.id, 1, "foreign"),
  };
}

async function json(res: Response) {
  return await res.json();
}

Deno.test("rubrics are versioned and unchanged text does not create a version", async () => {
  const { db, execution } = await setup();
  const v1 = await json(await saveRubric(db, execution.id, { rubric: "Be brief" }, headers));
  const same = await json(await saveRubric(db, execution.id, { rubric: "Be brief" }, headers));
  const v2 = await json(await saveRubric(db, execution.id, { rubric: "Be brief", reference: "ok" }, headers));
  assertEquals(v1.data.rubric.version, 1);
  assertEquals(same.data.rubric.version, 1);
  assertEquals(v2.data.rubric.version, 2);
  assertEquals((await json(await getRubric(db, execution.id, headers))).data.rubric.version, 2);
});

Deno.test("grading needs a rubric and only accepts runs of the execution", async () => {
  const { db, execution, a, foreign } = await setup();
  const deps = { runAgent: () => Promise.resolve("SCORE: 5\nREASON: ok") };
  assertEquals((await gradeRuns(db, execution.id, { historyIds: [a], judge }, headers, deps)).status, 400);
  await saveRubric(db, execution.id, { rubric: "r" }, headers);
  assertEquals((await gradeRuns(db, execution.id, { historyIds: [foreign], judge }, headers, deps)).status, 400);
});

Deno.test("a judge failure leaves the run unevaluated and the comparison data intact", async () => {
  const { db, execution, a, b } = await setup();
  await saveRubric(db, execution.id, { rubric: "r" }, headers);
  let calls = 0;
  const deps = {
    runAgent: () => {
      calls++;
      return calls === 1
        ? Promise.resolve("SCORE: 9\nREASON: great")
        : Promise.reject(new Error("API key invalid"));
    },
  };
  const res = await gradeRuns(db, execution.id, { historyIds: [a, b], judge }, headers, deps);
  assertEquals(res.status, 200);

  const { data } = await json(await listRuns(db, execution.id, headers));
  const byId = new Map<number, { result: unknown; grades: { status: string; score: number | null; error: string | null; judge: { model: string; version: number } }[] }>(
    data.runs.map((r: { historyId: number }) => [r.historyId, r]),
  );
  const graded = byId.get(a)!;
  const failed = byId.get(b)!;
  assertEquals(graded.grades[0].status, "graded");
  assertEquals(graded.grades[0].score, 9);
  assertEquals(graded.grades[0].judge.model, "judge-model");
  assertExists(graded.grades[0].judge.version);
  assertEquals(failed.grades[0].status, "failed");
  assertEquals(failed.grades[0].score, null);
  assertEquals(failed.result, "answer B");
});

Deno.test("re-grading with the same rubric and judge replaces the grade", async () => {
  const { db, execution, a } = await setup();
  await saveRubric(db, execution.id, { rubric: "r" }, headers);
  const grade = (text: string) =>
    gradeRuns(db, execution.id, { historyIds: [a], judge }, headers, {
      runAgent: () => Promise.resolve(text),
    });
  await grade("SCORE: 2\nREASON: bad");
  await grade("SCORE: 6\nREASON: better");
  const { data } = await json(await listRuns(db, execution.id, headers));
  const run = data.runs.find((r: { historyId: number }) => r.historyId === a);
  assertEquals(run.grades.length, 1);
  assertEquals(run.grades[0].score, 6);
});
