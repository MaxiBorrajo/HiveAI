import { assertEquals, assertStringIncludes } from "@std/assert";
import { initORM } from "../../../../../../infrastructure/db/orm.ts";
import { AttachmentRepository } from "../../../../../../infrastructure/db/repositories/attachment-repository.ts";
import { ExecutionRepository } from "../../../../../../infrastructure/db/repositories/execution-repository.ts";
import { readAttachment } from "../../../../../../core/attachments/attachment-storage.ts";
import { extractTextFromDocx } from "../../../../../../core/attachments/office-text-extractor.ts";
import { finalizeExecutionResult } from "../../../../../../modules/executions/use-cases/run-execution/result-normalizer.ts";
import {
  createDeliverableFiles,
  withoutReasoning,
} from "../../../../../../modules/executions/use-cases/run-execution/deliverable-files.ts";
import type { GraphNode } from "../../../../../../core/ai/visual-builder/types.ts";

function endNode(output: Record<string, unknown>): GraphNode[] {
  return [{ id: "end", name: "End", type: "end", config: { output } }];
}

Deno.test("finalizeExecutionResult - a file end node with text but no file on disk asks for the file to be built", () => {
  const result = finalizeExecutionResult(
    { report: "# Weekly report" },
    endNode({ type: "file", contentKey: "report", files: [{ name: "weekly.docx", path: "weekly.docx" }] }),
  );

  assertEquals(result.type, "file");
  assertEquals(result.files, []);
  assertEquals(result.content, "# Weekly report");
  assertEquals(result.metadata?.deliverableFiles, ["weekly.docx"]);
});

Deno.test("finalizeExecutionResult - without a declared name the file is Markdown", () => {
  const result = finalizeExecutionResult({ report: "text" }, endNode({ type: "file", contentKey: "report" }));

  assertEquals(result.metadata?.deliverableFiles, ["result.md"]);
});

Deno.test("finalizeExecutionResult - a file a plugin wrote to disk is used as it was", async () => {
  const path = await Deno.makeTempFile({ suffix: ".txt" });
  await Deno.writeTextFile(path, "from disk");

  const result = finalizeExecutionResult(
    { report: "from disk" },
    endNode({ type: "file", contentKey: "report", files: [{ name: "out.txt", path }] }),
  );

  assertEquals(result.files?.length, 1);
  assertEquals(result.metadata?.deliverableFiles, undefined);
  await Deno.remove(path);
});

Deno.test("finalizeExecutionResult - with no text there is nothing to build", () => {
  const result = finalizeExecutionResult({ ok: true }, endNode({ type: "file", contentKey: "missing" }));

  assertEquals(result.type, "boolean");
  assertEquals(result.metadata?.deliverableFiles, undefined);
});

async function setup() {
  const dataDir = await Deno.makeTempDir();
  const db = await initORM(dataDir);
  const executions = new ExecutionRepository(db);
  const { id: executionId } = await executions.create({ name: "flow", createdAt: 1, updatedAt: 1 });
  const { id: historyId } = await executions.createHistory({
    executionId,
    iteration: 1,
    result: {},
    createdAt: 1,
  });
  return { dataDir, repo: new AttachmentRepository(db), executionId, historyId };
}

Deno.test("createDeliverableFiles - attaches the built file to the run", async () => {
  const { dataDir, repo, executionId, historyId } = await setup();
  const warnings: string[] = [];

  const created = await createDeliverableFiles(
    dataDir,
    repo,
    executionId,
    historyId,
    { type: "file", summary: "", content: "# Weekly report\n\n- done", metadata: { deliverableFiles: ["weekly.docx"] } },
    (message) => warnings.push(message),
  );

  assertEquals([created, warnings], [1, []]);
  const [file] = await repo.findByExecutionId(executionId);
  assertEquals(
    [file.originalName, file.direction, file.executionId, file.executionHistoryId],
    ["weekly.docx", "output", executionId, historyId],
  );
  const { text } = await extractTextFromDocx(await readAttachment(dataDir, file.storagePath));
  assertEquals(text, "Weekly report\n•\tdone");
});

Deno.test("createDeliverableFiles - a name it cannot build is reported and the run goes on", async () => {
  const { dataDir, repo, executionId, historyId } = await setup();
  const warnings: string[] = [];

  const created = await createDeliverableFiles(
    dataDir,
    repo,
    executionId,
    historyId,
    { type: "file", summary: "", content: "x", metadata: { deliverableFiles: ["slides.pptx"] } },
    (message) => warnings.push(message),
  );

  assertEquals(created, 0);
  assertStringIncludes(warnings[0], "Could not create 'slides.pptx'");
});

Deno.test("withoutReasoning - the model's reasoning never reaches the file", () => {
  assertEquals(withoutReasoning("<think>\nplan it\n</think>\n\n# Report"), "# Report");
  assertEquals(withoutReasoning("# Report\n<think>unfinished"), "# Report");
  assertEquals(withoutReasoning("# Report about <thinking> tags"), "# Report about <thinking> tags");
});

Deno.test("createDeliverableFiles - an ordinary result builds nothing", async () => {
  const { dataDir, repo, executionId, historyId } = await setup();

  const created = await createDeliverableFiles(dataDir, repo, executionId, historyId, {
    type: "markdown",
    summary: "",
    content: "# Report",
  }, () => {});

  assertEquals(created, 0);
});
