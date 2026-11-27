import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  describeToolsUsed,
  type MessageRecord,
  toBaseMessage,
} from "../../../../infrastructure/db/repositories/message-repository.ts";

const record = (role: string, content: string, metadata: string | null) =>
  ({ id: 1, chatId: 1, role, content, timestamp: 1, metadata, vector: "[]" }) as MessageRecord;

Deno.test("describeToolsUsed - lists executor steps with a result snippet", () => {
  const note = describeToolsUsed(JSON.stringify({
    steps: [
      { node: "Executor", label: "run_shell", summary: "213" },
      { node: "Plugin", label: "run_shell", summary: "ignored" },
    ],
  }));
  assertStringIncludes(note, "run_shell -> 213");
  assertEquals(note.includes("ignored"), false);
});

Deno.test("describeToolsUsed - empty without tools, metadata or valid JSON", () => {
  assertEquals(describeToolsUsed(null), "");
  assertEquals(describeToolsUsed("not json"), "");
  assertEquals(describeToolsUsed(JSON.stringify({ steps: [] })), "");
});

Deno.test("toBaseMessage - agent replay carries the note, user text is untouched", () => {
  const meta = JSON.stringify({ steps: [{ node: "Executor", label: "file_read", summary: "x" }] });
  assertStringIncludes(String(toBaseMessage(record("agent", "hola", meta)).content), "file_read");
  assertEquals(toBaseMessage(record("user", "hola", meta)).content, "hola");
  assertEquals(toBaseMessage(record("agent", "hola", null)).content, "hola");
});
