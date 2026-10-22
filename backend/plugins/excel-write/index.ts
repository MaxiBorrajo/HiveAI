import { z } from "zod";
import * as XLSX from "xlsx";
import { dirname } from "node:path";
import { expandHome } from "../expand-home.ts";
import type {
  BeeContext,
  BeePlugin,
  SelectionTestCase,
  ExecutionTestCase,
} from "../file-ops/bee-plugin.ts";

const rowSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));

const sheetSchema = z.object({
  name: z.string().optional().describe("Sheet name. Defaults to 'Sheet1'."),
  rows: z
    .array(rowSchema)
    .describe(
      "Array of row objects. Each object's keys become the column headers (taken from the first row), values become the cells.",
    ),
});

const schema = z.object({
  path: z
    .string()
    .describe(
      "Target .xlsx file path. Can be a filename, relative path, or absolute path.",
    ),
  sheets: z
    .array(sheetSchema)
    .min(1)
    .describe(
      "One or more sheets to write. Each sheet has a name and an array of row objects (consistent keys across rows of the same sheet).",
    ),
});

type ExcelWriteSchema = typeof schema;

export default class ExcelWritePlugin implements BeePlugin<ExcelWriteSchema> {
  name = "excel_write";
  description =
    "Creates a real, valid .xlsx Excel file on disk from structured data (rows of key/value pairs). USE CASES: Use this when the user wants data (extracted from text, an image, a database query, etc.) saved as an Excel spreadsheet. Each row must be a flat object; object keys become column headers. Do not use this for plain text or CSV output — use file_ops for that.";

  schema = schema;
  returnDescription =
    "Returns a plain-text confirmation message with the absolute path of the written .xlsx file and the number of sheets/rows written.";

  selectionTests: SelectionTestCase<ExcelWriteSchema>[] = [
    {
      query: "save this data as an Excel file called report.xlsx",
      kind: "positive",
      shouldInvoke: true,
    },
    {
      query: "generate a spreadsheet with the extracted invoice rows",
      kind: "positive",
      shouldInvoke: true,
    },
    {
      query: "write these rows to output.xlsx",
      kind: "positive",
      shouldInvoke: true,
    },
    {
      query: "what time is it?",
      kind: "negative",
      shouldInvoke: false,
    },
    {
      query: "create a text file with these notes",
      kind: "negative",
      shouldInvoke: false,
    },
    {
      query: "read the contents of data.xlsx",
      kind: "negative",
      shouldInvoke: false,
    },
    {
      query: "export this table",
      kind: "ambiguous",
    },
  ];

  executionTests: ExecutionTestCase<ExcelWriteSchema>[] = [
    {
      description: "Write a single sheet with rows",
      kind: "happy",
      params: {
        path: `${Deno.cwd()}/.test-excel-write-happy1.xlsx`,
        sheets: [
          {
            name: "Data",
            rows: [
              { name: "Alice", age: 30 },
              { name: "Bob", age: 25 },
            ],
          },
        ],
      },
      expect: (output: string) => output.includes("Wrote") && output.includes(".xlsx"),
    },
    {
      description: "Write multiple sheets",
      kind: "happy",
      params: {
        path: `${Deno.cwd()}/.test-excel-write-happy2.xlsx`,
        sheets: [
          { name: "Sheet1", rows: [{ a: 1 }] },
          { name: "Sheet2", rows: [{ b: 2 }] },
        ],
      },
      expect: (output: string) => output.includes("2 sheet"),
    },
    {
      description: "Sheet with no rows still writes an empty sheet",
      kind: "edge",
      params: {
        path: `${Deno.cwd()}/.test-excel-write-edge-empty.xlsx`,
        sheets: [{ name: "Empty", rows: [] }],
      },
      expect: (output: string) => output.includes("Wrote"),
    },
    {
      description: "Missing sheets fails clearly",
      kind: "error",
      params: {
        path: `${Deno.cwd()}/.test-excel-write-error.xlsx`,
        sheets: undefined as unknown as z.infer<ExcelWriteSchema>["sheets"],
      },
      expect: (output: string) => output.toLowerCase().includes("invalid"),
    },
  ];

  get testCases() {
    return this.selectionTests;
  }

  initialize(_context: BeeContext): void {}

  async process(input: z.infer<ExcelWriteSchema>): Promise<string> {
    const parsed = this.schema.safeParse(input);
    if (!parsed.success) {
      return `The provided parameters are invalid. Error: ${parsed.error.message}`;
    }

    let { path, sheets } = parsed.data;
    path = expandHome(path);
    if (!path.toLowerCase().endsWith(".xlsx")) path += ".xlsx";

    try {
      await Deno.mkdir(dirname(path), { recursive: true });

      const workbook = XLSX.utils.book_new();
      let totalRows = 0;
      const usedNames = new Set<string>();

      sheets.forEach((sheet, index) => {
        let sheetName = (sheet.name?.trim() || `Sheet${index + 1}`).slice(0, 31);
        while (usedNames.has(sheetName)) {
          sheetName = `${sheetName.slice(0, 28)}_${index}`;
        }
        usedNames.add(sheetName);

        const worksheet = XLSX.utils.json_to_sheet(sheet.rows);
        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
        totalRows += sheet.rows.length;
      });

      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
      await Deno.writeFile(path, buffer);

      return `Wrote ${sheets.length} sheet(s) with ${totalRows} total row(s) to: ${path}`;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return `An error occurred while writing the Excel file: ${detail}`;
    }
  }
}
