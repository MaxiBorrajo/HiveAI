import { createChatModel } from "../providers/create-chat-model.ts";
import { normalizeModelRef, type ModelRef } from "../providers/types.ts";
import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { runConfigStep } from "../visual-builder/generation/generation-step.ts";
import { PLUGIN_DOMAIN_CONTEXT } from "./prompt-helpers.ts";
import type {
  PluginProcessDraft,
  PluginSignatureDraft,
  PluginTestsDraft,
} from "./types.ts";

const selectionTestSchema = z.object({
  query: z.string().describe("A realistic user message, in the user's own words"),
  kind: z.enum(["positive", "negative", "ambiguous"]),
  shouldInvoke: z.boolean().optional().describe("Whether THIS plugin should be the one selected for this query"),
  expectedParams: z.record(z.string(), z.unknown()).optional().describe("For positive cases: the parameters expected to be extracted from the query"),
});

const executionTestSchema = z.object({
  description: z.string().describe("Short label for the test case"),
  kind: z.enum(["happy", "edge", "error"]),
  params: z.record(z.string(), z.unknown()).describe("Input params for this test. For 'error' cases these may intentionally violate the schema."),
  expectSourceCode: z.string().describe(
    "The body of an `(output: string) => boolean` function (as TS statements, no signature) that returns true iff `output` meets this test case's expectation. Must end with `return <boolean expression>;`.",
  ),
});

const testsSchema = z.object({
  thought: z.string().default(""),
  selectionTests: z.array(selectionTestSchema).min(9).describe(
    "At least 9 cases: at least 3 'positive' (this plugin should be selected), 3 'negative' (a different kind of request, this plugin should NOT be selected), 3 'ambiguous' (could plausibly go either way). No two queries may be near-duplicates.",
  ),
  executionTests: z.array(executionTestSchema).min(9).describe(
    "At least 9 cases: at least 3 'happy' (typical valid input), 3 'edge' (valid but unusual input: empty strings, boundary numbers, etc.), 3 'error' (input that should make process() throw or return a clear failure message).",
  ),
});

export type TestsPhaseResult = z.infer<typeof testsSchema>;

export async function runTestsPhase(
  prompt: string,
  signature: PluginSignatureDraft,
  process: PluginProcessDraft,
  modelName: string,
  correctionContext?: { previous: TestsPhaseResult; issues: string[] },
  orchestrator?: ModelRef,
): Promise<PluginTestsDraft> {
  const agent = (
    await createChatModel(orchestrator ?? normalizeModelRef(modelName), {
      temperature: 0.2,
    })
  ).withStructuredOutput(testsSchema, { name: "PluginTestsCompiler" });

  const systemPrompt = `You are the Test Suite Compiler for the HiveAI Plugin Builder.

${PLUGIN_DOMAIN_CONTEXT}

Write the quality test suite for this plugin:
- Name: ${signature.name}
- Description: ${signature.description}
- Parameters: ${JSON.stringify(signature.schemaFields)}
- process() implementation:
\`\`\`
${process.processSourceCode}
\`\`\`

Selection tests check whether an LLM agent would correctly choose (or not choose) this plugin for a given user message — they do NOT run process(), they only judge intent matching.
Execution tests actually run process() with the given params and check the real string output against expectSourceCode. Write expectSourceCode defensively (e.g. check output.includes(...) or output.length, not brittle exact-string equality) since exact wording can vary.`;

  const messages: BaseMessage[] = [
    new SystemMessage(systemPrompt),
    new HumanMessage(`Plugin request: "${prompt}"`),
  ];

  if (correctionContext) {
    messages.push(
      new AIMessage(JSON.stringify(correctionContext.previous)),
      new HumanMessage(
        `This test suite is invalid:\n${correctionContext.issues.map((i) => `- ${i}`).join("\n")}\nFix ALL of the issues above and answer again with a corrected, complete test suite.`,
      ),
    );
  }

  const parsed = await runConfigStep<TestsPhaseResult, TestsPhaseResult>({
    label: "Plugin Tests Compiler",
    agent,
    messages,
    onSuccess: (result) => result,
    onFallback: (err) => {
      throw err;
    },
  });

  return {
    selectionTests: parsed.selectionTests,
    executionTests: parsed.executionTests,
  };
}
