import { createChatModel } from "../providers/create-chat-model.ts";
import { normalizeModelRef, type ModelRef } from "../providers/types.ts";
import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { runConfigStep } from "../visual-builder/generation/generation-step.ts";
import { PLUGIN_DOMAIN_CONTEXT } from "./prompt-helpers.ts";
import type { PluginProcessDraft, PluginSignatureDraft } from "./types.ts";

const processSchema = z.object({
  thought: z.string().default("").describe("Brief reasoning about how process() implements the plugin's action"),
  processSourceCode: z.string().describe(
    "The COMPLETE body of the async process(input, options) method, as TypeScript statements (no function signature, no surrounding braces). Must end with a `return <string>;` (or throw on genuine failure). `input` is already validated against the plugin's zod schema.",
  ),
  importsSourceCode: z.string().optional().describe(
    "Extra top-level import statements the process body needs, one per line (e.g. 'import { nanoid } from \"npm:nanoid@5\";'). Only npm: or full URL specifiers work — bare specifiers do not resolve. Omit if no extra imports are needed.",
  ),
});

export type ProcessPhaseResult = z.infer<typeof processSchema>;

export async function runProcessPhase(
  prompt: string,
  signature: PluginSignatureDraft,
  modelName: string,
  correctionContext?: { previous: ProcessPhaseResult; issues: string[] },
  orchestrator?: ModelRef,
): Promise<PluginProcessDraft> {
  const agent = (
    await createChatModel(orchestrator ?? normalizeModelRef(modelName), {
      temperature: 0.1,
    })
  ).withStructuredOutput(processSchema, { name: "PluginProcessCompiler" });

  const host = Deno.build.os;
  const systemPrompt = `You are the Process Compiler for the HiveAI Plugin Builder.

${PLUGIN_DOMAIN_CONTEXT}

Host Operating System: "${host}". Any shell command or path handling you write must be compatible with this OS.

Write the implementation body of this plugin's process() method:
- Plugin name: ${signature.name}
- Description: ${signature.description}
- Input parameters (already validated, accessible as fields of \`input\`): ${JSON.stringify(signature.schemaFields)}
${signature.returnDescription ? `- Expected return text: ${signature.returnDescription}` : ""}

Rules:
- Write plain TypeScript statements, not a function declaration — they are inserted directly inside an existing \`async process(input, options)\` method body.
- Always end with \`return <string>;\` describing what happened in plain text (or throw an Error for genuine failures — the microkernel catches it and reports it as a failed execution).
- Use only Deno/Web-standard APIs (fetch, Deno.readTextFile, Deno.Command, etc.) plus any npm:/URL imports you declare in importsSourceCode.
- Never reference variables outside process()'s scope besides \`input\` and \`options\`.`;

  const messages: BaseMessage[] = [
    new SystemMessage(systemPrompt),
    new HumanMessage(`Plugin request: "${prompt}"`),
  ];

  if (correctionContext) {
    messages.push(
      new AIMessage(JSON.stringify(correctionContext.previous)),
      new HumanMessage(
        `That implementation is invalid:\n${correctionContext.issues.map((i) => `- ${i}`).join("\n")}\nFix ALL of the issues above and answer again with a corrected process() body.`,
      ),
    );
  }

  const parsed = await runConfigStep<ProcessPhaseResult, ProcessPhaseResult>({
    label: "Plugin Process Compiler",
    agent,
    messages,
    onSuccess: (result) => result,
    onFallback: (err) => {
      throw err;
    },
  });

  return {
    processSourceCode: parsed.processSourceCode,
    importsSourceCode: parsed.importsSourceCode,
  };
}
