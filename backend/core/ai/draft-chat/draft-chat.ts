import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createChatModel } from "../providers/create-chat-model.ts";
import { normalizeModelRef, type ModelRef } from "../providers/types.ts";
import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { HiveMicrokernel } from "../../microkernel/hive-microkernel.ts";
import { PLUGIN_DOMAIN_CONTEXT, nameCollisionRule } from "./prompt-helpers.ts";
import { validateDraftPlugin } from "../../../modules/drafts/lib/validate-draft.ts";

const MAX_ATTEMPTS = 3;

export interface DraftChatEvent {
  type: "thinking" | "writing" | "validating" | "validation_error" | "done" | "error";
  message?: string;
  attempt?: number;
  issues?: string[];
  sourceCode?: string;
  summary?: string;
}

/**
 * This is a plain BeePlugin source file in TypeScript (a single index.ts,
 * written against the bee-plugin.ts contract below). The model answers with
 * the whole file as a single ```typescript fenced code block — never JSON —
 * so there is no structured-output schema that a model's quirks can
 * invalidate: any fence we get back is tried against the real compiler and
 * the real quality validator, and failures are fed back as plain text for
 * the model to fix, the same way a human would paste a compiler error back
 * into a chat.
 */
function buildSystemPrompt(existingPluginNames: string[]): string {
  return `You are the Plugin Editor for the HiveAI Draft Editor chat.

${PLUGIN_DOMAIN_CONTEXT}

You write and edit a single TypeScript file, "index.ts", that implements this interface (from "./bee-plugin.ts", already imported for you — do not redefine it):

\`\`\`typescript
interface BeePlugin<S extends z.ZodType = z.ZodType> {
  name: string;                    // unique snake_case id, e.g. "send_slack_message"
  description: string;             // what it does and when an agent should use it
  schema: S;                       // a z.object({...}) describing the plugin's input params
  returnDescription?: string;      // what the returned text looks like (optional)
  selectionTests: SelectionTestCase<S>[];
  executionTests: ExecutionTestCase<S>[];
  configFields?: { key: string; label: string; secret?: boolean }[];
  initialize(context: BeeContext): void | Promise<void>;
  process(input: z.infer<S>, options?: { signal?: AbortSignal }): string | Promise<string>;
  dispose?(): void | Promise<void>;
}

interface SelectionTestCase<S> {
  query: string;                        // a realistic user message, in their own words
  kind: "positive" | "negative" | "ambiguous";
  shouldInvoke?: boolean;               // whether THIS plugin should be selected for this query
  expectedParams?: Partial<z.infer<S>>; // for positive cases: params expected to be extracted
}

interface ExecutionTestCase<S> {
  description: string;
  kind: "happy" | "edge" | "error";
  params: z.infer<S>;                   // for "error" cases these may intentionally violate the schema
  expect: (output: string) => boolean;  // checks the real string process() returns
}
\`\`\`

Hard requirements, enforced by an automated validator — a draft that violates any of these will be rejected and you'll be asked to fix it:
- The file MUST have exactly one top-level \`export default class <Name> implements BeePlugin<typeof schema> { ... }\`. Not \`export class\`, not a named export, not an exported const/function — a DEFAULT-exported class declaration, literally starting with \`export default class\`.
- ALWAYS import zod as \`import { z } from "zod";\` — this exact bare specifier, already resolved to the project's Zod v4 by its import map. NEVER write \`npm:zod\`, \`npm:zod@3\`, \`npm:zod@4\`, or any other versioned/pinned specifier for zod — that loads a second, incompatible copy of the library and crashes the plugin loader at runtime, even though it may look fine in the editor.
- selectionTests: at least 9 total, with at least 3 "positive", 3 "negative", and 3 "ambiguous". No two queries may be near-duplicates (case-insensitive).
- executionTests: at least 9 total, with at least 3 "happy", 3 "edge", and 3 "error". Each case's "params" must satisfy "schema" (except "error" cases, which may intentionally violate it to test failure handling).
- process() must end with \`return <string>;\` on success (or throw an Error for genuine failures — the microkernel catches it and reports it as a failed execution). Write expect() defensively (output.includes(...), output.length, etc.), not brittle exact-string equality, since exact wording can vary.
- Besides the mandatory \`import { z } from "zod";\` and \`import type { BeeContext, BeePlugin } from "./bee-plugin.ts";\`, use only Deno/Web-standard APIs (fetch, Deno.env.get, Deno.readTextFile, Deno.Command, etc.) plus whatever extra imports you add for OTHER libraries (npm:/https: specifiers only for those — bare specifiers do not resolve for anything except "zod" and "./bee-plugin.ts").${nameCollisionRule(existingPluginNames)}

Minimal shape to follow (fill in the real logic, schema and at least 9+9 tests — this skeleton alone is NOT valid, it's just to show the required structure):
\`\`\`typescript
import { z } from "zod";
import type { BeeContext, BeePlugin } from "./bee-plugin.ts";

const schema = z.object({ /* ... */ });

export default class MyPlugin implements BeePlugin<typeof schema> {
  name = "my_plugin";
  description = "...";
  schema = schema;
  selectionTests = [ /* >=9, >=3 per kind */ ];
  executionTests = [ /* >=9, >=3 per kind */ ];
  initialize(context: BeeContext) {}
  async process(input: z.infer<typeof schema>, options?: { signal?: AbortSignal }): Promise<string> {
    // ...
    return "...";
  }
}
\`\`\`

Output format: your FIRST line must be \`SUMMARY: <one short sentence, in the user's own language, saying in plain terms what you did or changed — e.g. "Added a plugin that posts a message to Slack via webhook." or "Fixed the zod import and added the missing error test cases.">\`. Then, after that line, the COMPLETE, final content of index.ts as a single \`\`\`typescript fenced code block, starting with its imports. Nothing else besides the SUMMARY line and the fence — no other explanation before or after. When editing an existing file, make only the changes the user asked for and keep the rest intact (including existing tests that still make sense) unless your edit requires updating them.`;
}

function extractCodeFence(text: string): string | null {
  const trimmed = text.trim();
  const match =
    trimmed.match(/^```(?:ts|typescript)?\s*([\s\S]*?)```$/) ??
    trimmed.match(/```(?:ts|typescript)\s*([\s\S]*?)```/);
  if (match) return match[1].trim();
  // Some models omit the fence entirely when asked for "just the file".
  if (/^\s*import\b/.test(trimmed)) return trimmed;
  return null;
}

function extractSummary(text: string): string | undefined {
  const match = text.match(/^\s*SUMMARY:\s*(.+)$/m);
  return match?.[1]?.trim();
}

export async function* runDraftChat(
  prompt: string,
  modelName: string,
  currentSourceCode: string | undefined,
  existingPluginNames: string[],
  hive: HiveMicrokernel,
  draftDir: string,
  orchestrator?: ModelRef,
): AsyncGenerator<DraftChatEvent, { sourceCode: string }, unknown> {
  yield { type: "thinking", message: "Working on it..." };

  const model = await createChatModel(orchestrator ?? normalizeModelRef(modelName), {
    temperature: 0.1,
  });

  const messages: BaseMessage[] = [new SystemMessage(buildSystemPrompt(existingPluginNames))];

  if (currentSourceCode?.trim()) {
    messages.push(
      new HumanMessage(
        `Current index.ts:\n\`\`\`typescript\n${currentSourceCode}\n\`\`\`\n\nRequest: "${prompt}"`,
      ),
    );
  } else {
    messages.push(new HumanMessage(`Plugin request: "${prompt}"`));
  }

  let sourceCode = "";
  let lastIssues: string[] = [];
  let lastSummary: string | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await model.invoke(messages);
    const text = typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

    const extracted = extractCodeFence(text);
    if (!extracted) {
      lastIssues = ["The model's answer did not contain a ```typescript code block."];
      messages.push(
        new AIMessage(text),
        new HumanMessage(
          `Your answer must be ONLY the complete index.ts file inside a \`\`\`typescript fence. Try again.`,
        ),
      );
      yield { type: "validation_error", attempt, issues: lastIssues };
      continue;
    }

    sourceCode = extracted;
    lastSummary = extractSummary(text);
    yield { type: "writing", sourceCode, summary: lastSummary };
    yield { type: "validating" };

    await writeFile(join(draftDir, "index.ts"), sourceCode, "utf-8");
    const report = await validateDraftPlugin(hive, draftDir);

    if (report.valid) {
      yield { type: "done", sourceCode, summary: lastSummary };
      return { sourceCode };
    }

    lastIssues = report.issues;
    yield { type: "validation_error", attempt, issues: lastIssues };
    if (attempt === MAX_ATTEMPTS) break;

    const missingDefaultExport = lastIssues.some((i) =>
      /does not export a default class/i.test(i),
    );
    const reminder = missingDefaultExport
      ? `\nReminder: the file must start its class with the literal text "export default class" — e.g. "export default class MyPlugin implements BeePlugin<typeof schema> {". Check you didn't write "export class" or forget "default".`
      : "";

    messages.push(
      new AIMessage(text),
      new HumanMessage(
        `That version is invalid:\n${lastIssues.map((i) => `- ${i}`).join("\n")}\nFix ALL of the issues above and answer again with the COMPLETE corrected index.ts.${reminder}`,
      ),
    );
  }

  yield { type: "error", message: `Could not produce a valid plugin: ${lastIssues.join("; ")}` };
  return { sourceCode };
}
