import { assertEquals, assertExists } from "@std/assert";
import { initORM } from "../../../../../infrastructure/db/orm.ts";
import { ExecutionRepository } from "../../../../../infrastructure/db/repositories/execution-repository.ts";

// initORM caches a single db instance per process, so every call here shares
// the same underlying sqlite file. Tests must use unique names/ids and only
// assert on the rows they themselves created, never on total table counts.
async function makeRepository() {
  const tempDir = await Deno.makeTempDir();
  const db = await initORM(tempDir);
  return new ExecutionRepository(db);
}

function newExecution(name: string) {
  const now = Date.now();
  return { name, createdAt: now, updatedAt: now };
}

Deno.test("ExecutionRepository.create inserts and returns the created row with an id", async () => {
  const repo = await makeRepository();
  const created = await repo.create(newExecution("create-test"));
  assertExists(created.id);
  assertEquals(created.name, "create-test");
});

Deno.test("ExecutionRepository.findById returns undefined for a non-existent id", async () => {
  const repo = await makeRepository();
  assertEquals(await repo.findById(999_999), undefined);
});

Deno.test("ExecutionRepository.findById returns the persisted row", async () => {
  const repo = await makeRepository();
  const created = await repo.create(newExecution("findable"));
  const found = await repo.findById(created.id);
  assertEquals(found?.name, "findable");
});

Deno.test("ExecutionRepository.findAll includes a freshly created row and orders by updatedAt descending", async () => {
  const repo = await makeRepository();
  const older = await repo.create({ name: "order-older", createdAt: 1000, updatedAt: 1000 });
  const newer = await repo.create({
    name: "order-newer",
    createdAt: Date.now() + 10_000,
    updatedAt: Date.now() + 10_000,
  });

  const all = await repo.findAll();
  const olderIdx = all.findIndex((e: { id: number }) => e.id === older.id);
  const newerIdx = all.findIndex((e: { id: number }) => e.id === newer.id);
  assertExists(olderIdx >= 0 && newerIdx >= 0 ? true : undefined);
  // newer (higher updatedAt) must appear before older in descending order
  assertEquals(newerIdx < olderIdx, true);
});

Deno.test("ExecutionRepository.update patches fields and bumps updatedAt", async () => {
  const repo = await makeRepository();
  const created = await repo.create(newExecution("update-before"));
  const originalUpdatedAt = created.updatedAt;

  await new Promise((r) => setTimeout(r, 5));
  await repo.update(created.id, { name: "update-after" });

  const updated = await repo.findById(created.id);
  assertEquals(updated?.name, "update-after");
  assertEquals((updated?.updatedAt ?? 0) > originalUpdatedAt, true);
});

Deno.test("ExecutionRepository.delete removes the row", async () => {
  const repo = await makeRepository();
  const created = await repo.create(newExecution("delete-me"));
  await repo.delete(created.id);
  assertEquals(await repo.findById(created.id), undefined);
});

Deno.test("ExecutionRepository.delete is a no-op for a non-existent id", async () => {
  const repo = await makeRepository();
  const survivor = await repo.create(newExecution("survivor"));
  await repo.delete(999_999);
  assertExists(await repo.findById(survivor.id));
});

// --- Execution Graphs ---

Deno.test("ExecutionRepository.createGraph persists a graph linked to its execution", async () => {
  const repo = await makeRepository();
  const execution = await repo.create(newExecution("graph-owner"));

  const graph = await repo.createGraph({
    executionId: execution.id,
    graph: { nodes: [], edges: [] },
    state: {},
    createdAt: Date.now(),
  });

  assertExists(graph.id);
  const found = await repo.findGraphById(graph.id);
  assertEquals(found?.executionId, execution.id);
});

Deno.test("ExecutionRepository.findGraphById returns undefined for a non-existent id", async () => {
  const repo = await makeRepository();
  assertEquals(await repo.findGraphById(999_999), undefined);
});

// --- Execution History ---

Deno.test("ExecutionRepository.createHistory persists a history row and countHistories reflects it", async () => {
  const repo = await makeRepository();
  const execution = await repo.create(newExecution("history-owner"));

  assertEquals(await repo.countHistories(execution.id), 0);

  await repo.createHistory({
    executionId: execution.id,
    iteration: 1,
    result: { output: "done" },
    createdAt: Date.now(),
  });

  assertEquals(await repo.countHistories(execution.id), 1);
});

Deno.test("ExecutionRepository.countHistories only counts rows for the given execution", async () => {
  const repo = await makeRepository();
  const execA = await repo.create(newExecution("history-a"));
  const execB = await repo.create(newExecution("history-b"));

  await repo.createHistory({ executionId: execA.id, iteration: 1, result: {}, createdAt: Date.now() });
  await repo.createHistory({ executionId: execA.id, iteration: 2, result: {}, createdAt: Date.now() });
  await repo.createHistory({ executionId: execB.id, iteration: 1, result: {}, createdAt: Date.now() });

  assertEquals(await repo.countHistories(execA.id), 2);
  assertEquals(await repo.countHistories(execB.id), 1);
});

Deno.test("ExecutionRepository.findHistoryById returns the persisted history row", async () => {
  const repo = await makeRepository();
  const execution = await repo.create(newExecution("history-find"));
  const created = await repo.createHistory({
    executionId: execution.id,
    iteration: 1,
    result: { output: "hello" },
    createdAt: Date.now(),
  });

  const found = await repo.findHistoryById(created.id);
  assertEquals((found?.result as any).output, "hello");
});

Deno.test("ExecutionRepository.findHistoryById returns undefined for a non-existent id", async () => {
  const repo = await makeRepository();
  assertEquals(await repo.findHistoryById(999_999), undefined);
});
