import { assertEquals } from "@std/assert";
import { normalizeExecutionResult } from "./result-normalizer.ts";
import { GraphNode } from "../../../../core/ai/visual-builder/types.ts";

function node(overrides: Partial<GraphNode>): GraphNode {
  return { id: "n1", name: "Node", type: "plugin", config: {}, ...overrides };
}

Deno.test("normalizeExecutionResult - passes through an already-compliant ExecutionResult", () => {
  const compliant = { type: "markdown" as const, summary: "already done", content: "# Hi" };
  const result = normalizeExecutionResult({ result: compliant }, []);
  assertEquals(result, compliant);
});

Deno.test("normalizeExecutionResult - boolean result maps to type 'boolean' with a readable summary", () => {
  const trueResult = normalizeExecutionResult({ result: true }, []);
  assertEquals(trueResult.type, "boolean");
  assertEquals(trueResult.content, true);

  const falseResult = normalizeExecutionResult({ result: false }, []);
  assertEquals(falseResult.type, "boolean");
  assertEquals(falseResult.content, false);
});

Deno.test("normalizeExecutionResult - array of objects is detected as tabular", () => {
  const result = normalizeExecutionResult(
    { result: [{ id: 1 }, { id: 2 }] },
    [],
  );
  assertEquals(result.type, "table");
  assertEquals(result.summary.includes("2"), true);
});

Deno.test("normalizeExecutionResult - array of primitives falls back to json", () => {
  const result = normalizeExecutionResult({ result: [1, 2, 3] }, []);
  assertEquals(result.type, "json");
});

Deno.test("normalizeExecutionResult - plain object maps to type 'json'", () => {
  const result = normalizeExecutionResult({ result: { score: 9 } }, []);
  assertEquals(result.type, "json");
  assertEquals(result.content, { score: 9 });
});

Deno.test("normalizeExecutionResult - string with markdown markers maps to type 'markdown'", () => {
  const result = normalizeExecutionResult({ result: "# Title\n\nSome **bold** text" }, []);
  assertEquals(result.type, "markdown");
});

Deno.test("normalizeExecutionResult - plain string with no markdown markers maps to type 'text'", () => {
  const result = normalizeExecutionResult({ result: "just plain text, nothing special" }, []);
  assertEquals(result.type, "text");
});

Deno.test("normalizeExecutionResult - shell output from a trailing run_shell node maps to type 'terminal'", () => {
  const shellNode = node({
    id: "shell1",
    type: "plugin",
    config: { pluginId: "run_shell", inputMapping: { command: "ls -la" } },
  });
  const result = normalizeExecutionResult(
    { result: "total 0\ndrwxr-xr-x  2 user user" },
    [shellNode],
  );
  assertEquals(result.type, "terminal");
  assertEquals(result.metadata?.command, "ls -la");
});

Deno.test("normalizeExecutionResult - run_shell node NOT at the end does not force terminal type", () => {
  const shellNode = node({ id: "shell1", type: "plugin", config: { pluginId: "run_shell" } });
  const otherNode = node({ id: "other", type: "plugin", config: { pluginId: "web_search" } });
  const result = normalizeExecutionResult(
    { result: "some plain text result here" },
    [shellNode, otherNode],
  );
  assertEquals(result.type, "text");
});

Deno.test("normalizeExecutionResult - undefined/null result falls back to empty text", () => {
  const result = normalizeExecutionResult({}, []);
  assertEquals(result.type, "text");
  assertEquals(result.content, "");
});

Deno.test("normalizeExecutionResult - a file_ops node with content written to a state key produces a 'file' result when the file exists on disk", async () => {
  const tempFile = await Deno.makeTempFile({ suffix: ".txt" });
  await Deno.writeTextFile(tempFile, "hello from disk");

  const fileNode = node({
    id: "save",
    type: "plugin",
    config: {
      pluginId: "file_ops",
      inputMapping: { path: tempFile, content: "reportText", operation: "write" },
    },
  });

  const result = normalizeExecutionResult(
    { reportText: "hello from disk", result: `Wrote 15 chars to: ${tempFile}` },
    [fileNode],
  );

  assertEquals(result.type, "file");
  assertEquals(result.files?.[0]?.name, tempFile.split(/[\\/]/).pop());

  await Deno.remove(tempFile);
});

Deno.test("normalizeExecutionResult - a file_ops node whose target file does NOT exist on disk does not report type 'file'", () => {
  const fileNode = node({
    id: "save",
    type: "plugin",
    config: { pluginId: "file_ops", inputMapping: { path: "/nonexistent/path/output.txt" } },
  });

  const result = normalizeExecutionResult(
    { result: "some completion message without a file marker" },
    [fileNode],
  );

  assertEquals(result.type === "file", false);
});
