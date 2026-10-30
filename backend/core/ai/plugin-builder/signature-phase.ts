import { createChatModel } from "../providers/create-chat-model.ts";
import { normalizeModelRef, type ModelRef } from "../providers/types.ts";
import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { runConfigStep } from "../visual-builder/generation/generation-step.ts";
import { PLUGIN_DOMAIN_CONTEXT, nameCollisionRule } from "./prompt-helpers.ts";
import { buildSchemaSourceCode } from "./code-serializer.ts";
import type { PluginSignatureDraft } from "./types.ts";

const zodFieldSchema = z.object({
  name: z.string().describe("camelCase parameter name"),
  zodType: z.enum(["string", "number", "boolean", "enum", "array", "object"]),
  description: z.string().describe("What this parameter means, shown to the LLM that calls this plugin"),
  optional: z.boolean().optional(),
  enumValues: z.array(z.string()).optional().describe("Required when zodType is 'enum'"),
}).describe("One input parameter of the plugin");

const signatureSchema = z.object({
  thought: z.string().default("").describe("Brief reasoning about what the plugin should do and why these parameters are the right ones"),
  name: z.string().describe("snake_case unique plugin name, e.g. 'send_slack_message'"),
  description: z.string().describe("Clear description of what the plugin does and when an agent should use it"),
  returnDescription: z.string().optional().describe("What the plugin's text output looks like"),
  schemaFields: z.array(zodFieldSchema).describe("The plugin's input parameters (empty array if it takes none)"),
});

export type SignaturePhaseResult = z.infer<typeof signatureSchema>;

export async function runSignaturePhase(
  prompt: string,
  modelName: string,
  existingPluginNames: string[],
  correctionContext?: { previous: SignaturePhaseResult; issues: string[] },
  orchestrator?: ModelRef,
): Promise<PluginSignatureDraft> {
  const agent = (
    await createChatModel(orchestrator ?? normalizeModelRef(modelName), {
      temperature: 0.1,
    })
  ).withStructuredOutput(signatureSchema, { name: "PluginSignatureCompiler" });

  const systemPrompt = `You are the Signature Compiler for the HiveAI Plugin Builder.

${PLUGIN_DOMAIN_CONTEXT}

Given the user's description of a plugin they want, decide: a unique snake_case name, a clear description, the optional return description, and the list of input parameters (as a typed schema). Keep parameters minimal — only what the plugin's action genuinely needs. Prefer flat, simple types (string/number/boolean/enum) over nested objects/arrays unless the task clearly requires a list or structured input.${nameCollisionRule(existingPluginNames)}`;

  const messages: BaseMessage[] = [
    new SystemMessage(systemPrompt),
    new HumanMessage(`Plugin request: "${prompt}"`),
  ];

  if (correctionContext) {
    messages.push(
      new AIMessage(JSON.stringify(correctionContext.previous)),
      new HumanMessage(
        `That signature is invalid:\n${correctionContext.issues.map((i) => `- ${i}`).join("\n")}\nFix ALL of the issues above and answer again.`,
      ),
    );
  }

  const parsed = await runConfigStep<SignaturePhaseResult, SignaturePhaseResult>({
    label: "Plugin Signature Compiler",
    agent,
    messages,
    onSuccess: (result) => result,
    onFallback: (err) => {
      throw err;
    },
  });

  return {
    name: parsed.name,
    description: parsed.description,
    returnDescription: parsed.returnDescription,
    schemaFields: parsed.schemaFields,
    schemaSourceCode: buildSchemaSourceCode(parsed.schemaFields),
  };
}
