import { assert, assertEquals } from "@std/assert";
import { join } from "node:path";
import * as XLSX from "xlsx";
import type { BeeContext } from "../../../../core/microkernel/bee-plugin.ts";
import { validatePlugin } from "../../../../core/microkernel/plugin-quality-validator.ts";
import ExcelWritePlugin from "../../../../plugins/excel-write/index.ts";

const PLUGINS_DIR = new URL("../../../../plugins/", import.meta.url);
const CORE_BEE_PLUGIN = new URL("../../../../core/microkernel/bee-plugin.ts", import.meta.url);

const context: BeeContext = {
  getDataDir: () => "",
  getModel: () => "test-model",
  requestApproval: () => Promise.resolve(true),
  reportStep: () => {},
  getConfig: () => Promise.resolve(undefined),
};

Deno.test("every bundled plugin ships the bee-plugin.ts the loader requires", async () => {
  const expected = await Deno.readTextFile(CORE_BEE_PLUGIN);
  for await (const entry of Deno.readDir(PLUGINS_DIR)) {
    if (!entry.isDirectory) continue;
    const copy = await Deno.readTextFile(new URL(`${entry.name}/bee-plugin.ts`, PLUGINS_DIR))
      .catch(() => undefined);
    assertEquals(copy, expected, `plugins/${entry.name}/bee-plugin.ts is missing or outdated`);
  }
});

Deno.test("every bundled plugin passes the test quality check the loader enforces", async () => {
  for await (const entry of Deno.readDir(PLUGINS_DIR)) {
    if (!entry.isDirectory) continue;
    const { default: Plugin } = await import(new URL(`${entry.name}/index.ts`, PLUGINS_DIR).href);
    const report = validatePlugin(new Plugin());
    assert(report.valid, `plugins/${entry.name} would not load: ${JSON.stringify(report.issues)}`);
  }
});

Deno.test("excel_write satisfies its own execution test suite", async () => {
  const original = Deno.cwd();
  const temp = await Deno.makeTempDir();
  // Its test cases write next to the working directory.
  Deno.chdir(temp);
  try {
    const plugin = new ExcelWritePlugin();
    plugin.initialize(context);
    for (const testCase of plugin.executionTests) {
      const output = await plugin.process(testCase.params);
      assert(testCase.expect(output), `"${testCase.description}" failed. Got: ${output}`);
    }
  } finally {
    Deno.chdir(original);
    await Deno.remove(temp, { recursive: true });
  }
});

Deno.test("excel_write writes a workbook Excel can read back", async () => {
  const temp = await Deno.makeTempDir();
  try {
    const path = join(temp, "sales.xlsx");
    await new ExcelWritePlugin().process({
      path,
      sheets: [{ name: "Q1", rows: [{ month: "jan", total: 100 }, { month: "feb", total: 150 }] }],
    });

    const book = XLSX.read(await Deno.readFile(path), { type: "array" });
    assertEquals(book.SheetNames, ["Q1"]);
    assertEquals(XLSX.utils.sheet_to_json(book.Sheets.Q1), [
      { month: "jan", total: 100 },
      { month: "feb", total: 150 },
    ]);
  } finally {
    await Deno.remove(temp, { recursive: true });
  }
});
