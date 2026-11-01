import { assert, assertEquals, assertFalse, assertThrows } from "@std/assert";
import { join } from "node:path";
import {
  assertPluginShape,
  checkPluginConformance,
} from "../../../../core/microkernel/plugin-conformance.ts";

const COUNTER = new URL("../../../../plugins/counter/index.ts", import.meta.url);

async function pluginDir(source: string): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "conformance-test-" });
  await Deno.writeTextFile(join(dir, "index.ts"), source);
  return dir;
}

Deno.test("a valid plugin conforms without shipping bee-plugin.ts", async () => {
  const dir = await pluginDir(await Deno.readTextFile(COUNTER));
  try {
    const result = await checkPluginConformance(dir);
    assertEquals(result.issues, []);
    assert(result.ok);
    // The source dir is left untouched (no interface file injected).
    assertFalse(await Deno.stat(join(dir, "bee-plugin.ts")).then(() => true, () => false));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a plugin that breaks the interface is rejected with the compiler message", async () => {
  const source = (await Deno.readTextFile(COUNTER)).replace(
    /async process\([^)]*\)[^{]*\{/,
    "process(): number {\n    return 1;\n  }\n  async other() {",
  );
  const dir = await pluginDir(source);
  try {
    const result = await checkPluginConformance(dir);
    assertFalse(result.ok);
    assert(result.issues[0].includes("BeePlugin interface"));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("unannotated test arrays (widened kind literals) are accepted", async () => {
  const dir = await pluginDir(`import { z } from "zod";
import type { BeeContext, BeePlugin } from "./bee-plugin.ts";

const schema = z.object({ text: z.string() });

export default class CountWordsPlugin implements BeePlugin<typeof schema> {
  name = "count_words";
  description = "Counts words.";
  schema = schema;
  selectionTests = [
    { query: "count the words", kind: "positive", shouldInvoke: true, expectedParams: { text: "a b" } },
    { query: "what time is it", kind: "negative", shouldInvoke: false },
  ];
  executionTests = [
    { description: "counts", kind: "happy", params: { text: "a b" }, expect: (o: string) => o.includes("2") },
  ];
  initialize(_context: BeeContext) {}
  async process(input: z.infer<typeof schema>): Promise<string> {
    return String(input.text.split(" ").length);
  }
}
`);
  try {
    const result = await checkPluginConformance(dir);
    assertEquals(result.issues, []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a plugin without a default export class is rejected", async () => {
  const dir = await pluginDir(`export const x = 1;`);
  try {
    assertFalse((await checkPluginConformance(dir)).ok);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("assertPluginShape checks presence and types of fields", () => {
  const valid = {
    name: "p",
    description: "d",
    schema: { safeParse: () => ({}) },
    process: () => "",
    selectionTests: [],
    executionTests: [],
  };
  assertPluginShape(valid);
  assertThrows(() => assertPluginShape({ ...valid, name: 3 }), TypeError, "'name'");
  assertThrows(() => assertPluginShape({ ...valid, process: "x" }), TypeError, "'process'");
  assertThrows(() => assertPluginShape({ ...valid, schema: {} }), TypeError, "'schema'");
  const { executionTests: _omit, ...partial } = valid;
  assertThrows(() => assertPluginShape(partial), TypeError, "executionTests");
});
