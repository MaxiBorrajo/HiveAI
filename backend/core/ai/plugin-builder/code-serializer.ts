import type {
  PluginDraft,
  PluginExecutionTestDraft,
  PluginSelectionTestDraft,
  ZodFieldSpec,
} from "./types.ts";

function jsString(value: string): string {
  return JSON.stringify(value);
}

function serializeZodField(field: ZodFieldSpec): string {
  let base: string;
  switch (field.zodType) {
    case "string":
      base = "z.string()";
      break;
    case "number":
      base = "z.number()";
      break;
    case "boolean":
      base = "z.boolean()";
      break;
    case "enum":
      base = `z.enum([${(field.enumValues ?? []).map(jsString).join(", ")}])`;
      break;
    case "array":
      base = `z.array(${field.items ? serializeZodField(field.items) : "z.unknown()"})`;
      break;
    case "object":
      base = "z.record(z.string(), z.unknown())";
      break;
    default:
      base = "z.unknown()";
  }
  base += `.describe(${jsString(field.description)})`;
  if (field.optional) base += ".optional()";
  return base;
}

export function buildSchemaSourceCode(fields: ZodFieldSpec[]): string {
  const entries = fields
    .map((f) => `    ${JSON.stringify(f.name)}: ${serializeZodField(f)},`)
    .join("\n");
  return `z.object({\n${entries}\n  })`;
}

function serializeSelectionTest(t: PluginSelectionTestDraft): string {
  const parts = [
    `query: ${jsString(t.query)}`,
    `kind: ${jsString(t.kind)}`,
  ];
  if (t.shouldInvoke !== undefined) parts.push(`shouldInvoke: ${t.shouldInvoke}`);
  if (t.expectedParams) {
    parts.push(`expectedParams: ${JSON.stringify(t.expectedParams)}`);
  }
  return `  {\n    ${parts.join(",\n    ")},\n  }`;
}

function serializeExecutionTest(t: PluginExecutionTestDraft): string {
  const parts = [
    `description: ${jsString(t.description)}`,
    `kind: ${jsString(t.kind)}`,
    `params: ${JSON.stringify(t.params)}`,
    `expect: (output: string) => {\n${t.expectSourceCode}\n    }`,
  ];
  return `  {\n    ${parts.join(",\n    ")},\n  }`;
}

/**
 * Assembles a full index.ts for a BeePlugin from a structured draft.
 * The schema (zod) is generated deterministically from schemaFields (or the
 * user's rawZodOverride); process() and each execution test's `expect` are
 * LLM-authored TS source text, inserted verbatim.
 */
export function serializePluginDraft(draft: PluginDraft): string {
  const { signature, process, tests } = draft;
  const schemaSource = signature.rawZodOverride?.trim() ||
    signature.schemaSourceCode;

  const selectionTestsSource = tests.selectionTests
    .map(serializeSelectionTest)
    .join(",\n");
  const executionTestsSource = tests.executionTests
    .map(serializeExecutionTest)
    .join(",\n");

  return `import { z } from "zod";
import type { BeePlugin, BeeContext } from "./bee-plugin.ts";
${process.importsSourceCode ?? ""}

const schema = ${schemaSource};

export default class ${toClassName(signature.name)} implements BeePlugin<typeof schema> {
  name = ${jsString(signature.name)};
  description = ${jsString(signature.description)};
  schema = schema;
  ${signature.returnDescription ? `returnDescription = ${jsString(signature.returnDescription)};` : ""}

  selectionTests = [
${selectionTestsSource}
  ];

  executionTests = [
${executionTestsSource}
  ];

  ${process.configFields && process.configFields.length > 0
    ? `configFields = ${JSON.stringify(process.configFields)};`
    : ""}

  initialize(context: BeeContext) {}

  async process(input: z.infer<typeof schema>, options?: { signal?: AbortSignal }): Promise<string> {
${process.processSourceCode}
  }
}
`;
}

function toClassName(pluginName: string): string {
  const pascal = pluginName
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
  return `${pascal || "Generated"}Plugin`;
}
