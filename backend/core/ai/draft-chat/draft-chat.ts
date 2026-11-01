import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createChatModel } from "../providers/create-chat-model.ts";
import { normalizeModelRef, type ModelRef } from "../providers/types.ts";
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { HiveMicrokernel } from "../../microkernel/hive-microkernel.ts";
import { PLUGIN_DOMAIN_CONTEXT, nameCollisionRule } from "./prompt-helpers.ts";
import { validateDraftPlugin } from "../../../modules/drafts/lib/validate-draft.ts";

const MAX_ATTEMPTS = 3;
/** Research rounds (model asks for tools, we run them) before it must answer. */
const MAX_TOOL_ROUNDS = 8;
const MAX_TOOL_OUTPUT_CHARS = 6000;
const TOOL_PREVIEW_CHARS = 400;

export interface DraftChatEvent {
  type:
    | "thinking"
    | "tool_call"
    | "tool_result"
    | "writing"
    | "validating"
    | "validation_error"
    | "done"
    | "error";
  message?: string;
  attempt?: number;
  issues?: string[];
  sourceCode?: string;
  summary?: string;
  tool?: string;
  input?: unknown;
  ok?: boolean;
  output?: string;
}

/** The prompt quotes the real interface file so it can never drift from it. */
function readBeePluginSource(): string {
  return Deno.readTextFileSync(
    new URL("../../microkernel/bee-plugin.ts", import.meta.url),
  ).trim();
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
function toolsGuidance(toolNames: string[]): string {
  if (toolNames.length === 0) return "";
  return `

You can call tools to research before writing: ${toolNames.join(", ")}. Use them when they help you get the plugin right — for example to read the official documentation of the API or library the plugin talks to, check a request/response format, or look at a file the user mentions. Don't research things you already know, and do not run commands or write files that change the user's system unless the request explicitly asks for it. When you have what you need, stop calling tools and answer in the output format below.`;
}

function buildSystemPrompt(
  existingPluginNames: string[],
  toolNames: string[] = [],
): string {
  return `You are the Plugin Editor for the HiveAI Draft Editor chat.

${PLUGIN_DOMAIN_CONTEXT}${toolsGuidance(toolNames)}

You write and edit a single TypeScript file, "index.ts", that implements this interface (from "./bee-plugin.ts", already imported for you — do not redefine it):

\`\`\`typescript
${readBeePluginSource()}
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

function messageText(message: AIMessage): string {
  return typeof message.content === "string"
    ? message.content
    : JSON.stringify(message.content);
}

type DraftTool = StructuredToolInterface;

/**
 * Lets the model call the user's active plugins (web search, file reads...)
 * until it produces an answer without tool calls, then returns that answer.
 */
export async function* answerWithTools(
  model: Awaited<ReturnType<typeof createChatModel>>,
  tools: DraftTool[],
  messages: BaseMessage[],
): AsyncGenerator<DraftChatEvent, string, unknown> {
  let usableTools = tools;

  for (let round = 0; ; round++) {
    const canUseTools = usableTools.length > 0 && round < MAX_TOOL_ROUNDS;
    let response: AIMessage;
    try {
      response = (canUseTools
        ? await model.bindTools(usableTools).invoke(messages)
        : await model.invoke(messages)) as AIMessage;
    } catch (error) {
      if (!canUseTools || round > 0) throw error;
      // The model (or provider) does not support tool calling: carry on without.
      usableTools = [];
      yield {
        type: "thinking",
        message: "This model can't use tools; writing without research.",
      };
      response = (await model.invoke(messages)) as AIMessage;
    }

    const calls = response.tool_calls ?? [];
    if (calls.length === 0 || !canUseTools) return messageText(response);

    messages.push(response);
    for (const call of calls) {
      yield { type: "tool_call", tool: call.name, input: call.args };

      const tool = usableTools.find((t) => t.name === call.name);
      let ok = true;
      let output: string;
      try {
        output = tool
          ? String(await tool.invoke(call.args))
          : `Unknown tool "${call.name}".`;
        ok = tool !== undefined;
      } catch (error) {
        ok = false;
        output = `The tool failed: ${error instanceof Error ? error.message : String(error)}`;
      }

      yield {
        type: "tool_result",
        tool: call.name,
        ok,
        output: output.slice(0, TOOL_PREVIEW_CHARS),
      };
      messages.push(
        new ToolMessage({
          content: output.slice(0, MAX_TOOL_OUTPUT_CHARS),
          tool_call_id: call.id ?? call.name,
          name: call.name,
        }),
      );
    }
  }
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

  const tools = hive.getTools() as unknown as DraftTool[];
  const messages: BaseMessage[] = [
    new SystemMessage(
      buildSystemPrompt(existingPluginNames, tools.map((t) => t.name)),
    ),
  ];

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
    const text = yield* answerWithTools(model, tools, messages);

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
