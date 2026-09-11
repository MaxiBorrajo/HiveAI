import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { GraphNode } from "@langchain/langgraph/web";
import { ChatOllama } from "@langchain/ollama";
import z from "zod";
import { HiveMicrokernel } from "../../../../microkernel/hive-microkernel.ts";
import { parseModelJSON } from "../../utils.ts";
import { HiveAIState } from "../graph.ts";
import {
  abstentionVerificatorHumanPrompt,
  buildAbstentionVerificatorSystemPrompt,
} from "./prompt.ts";
import { MAX_ATTEMPTS } from "../constants.ts";
import { buildNativeTools, getNativeTool } from "../nativeTools.ts";

export const AbstentionVerificator: GraphNode<typeof HiveAIState> = async (
  state,
) => {
  const start = performance.now();
  const microkernel = HiveMicrokernel.getInstance();

  const AbstentionVerificatorResponse = z.object({
    action: z.enum(["confirm", "challenge"]),
    reason: z.string(),
    suggestedTool: z.string().optional(),
  });

  const nativeTools = buildNativeTools(state.chatId);
  const catalogSummary = [
    ...microkernel
      .getRegisteredPlugins()
      .filter((c) => microkernel.isActive(c.name))
      .map((c) => `- ${c.name}: ${c.description}`),
    ...nativeTools.map((t) => `- ${t.name}: ${t.description}`),
  ].join("\n");

  console.log(
    `[SADER - AbstentionVerificator] state.modelOptions:`,
    state.modelOptions,
  );
  const verificatorOptions = {
    model: state.model,
    think: true,
    format: z.toJSONSchema(AbstentionVerificatorResponse),
    ...state.modelOptions,
  };
  const verificatorModel = new ChatOllama(verificatorOptions);

  console.log(
    `[SADER - AbstentionVerificator] Effective Ollama options:`,
    verificatorOptions,
  );

  const response = await verificatorModel.invoke([
    new SystemMessage(buildAbstentionVerificatorSystemPrompt()),
    new HumanMessage(
      abstentionVerificatorHumanPrompt(state.currentPrompt, catalogSummary),
    ),
  ]);

  console.log(
    `\n[SADER - AbstentionVerificator] Checking if we really should abstain`,
  );
  console.log(
    `[SADER - AbstentionVerificator] Raw model response:`,
    response.content,
  );

  const parsed = parseModelJSON<{
    action: "confirm" | "challenge";
    reason: string;
    suggestedTool?: string;
  }>(response.content as string, "AbstentionVerificator");

  console.log(
    `[SADER - AbstentionVerificator] Parsed verification result:`,
    parsed,
  );

  const durationMs = performance.now() - start;

  if (!parsed || parsed.action === "confirm") {
    return {
      abstentionVerified: true,
      abstentionChallenged: false,
      steps: [
        {
          node: "AbstentionVerificator" as const,
          label: "Confirming abstention",
          durationMs,
          summary: "Confirmed that no tool is needed",
        },
      ],
    };
  }

  const suggestedTool = parsed.suggestedTool
    ? (microkernel.getPlugin(parsed.suggestedTool) ??
      getNativeTool(parsed.suggestedTool, state.chatId))
    : undefined;

  if (!suggestedTool) {
    return {
      abstentionVerified: true,
      abstentionChallenged: false,
      steps: [
        {
          node: "AbstentionVerificator" as const,
          label: "Confirming abstention",
          durationMs,
          summary: parsed.suggestedTool
            ? `Challenge rejected: suggested tool "${parsed.suggestedTool}" is not in the catalog`
            : "Challenge rejected: verificator did not name a tool to switch to",
        },
      ],
    };
  }

  return {
    abstentionVerified: true,
    abstentionChallenged: true,
    correction: {
      tool: parsed.suggestedTool ?? "unknown",
      reason: parsed.reason,
    },
    attempts: 1,
    selectionAttempts: 1,
    steps: [
      {
        node: "AbstentionVerificator" as const,
        label: "Confirming abstention",
        durationMs,
        summary: `Challenged abstention: ${parsed.reason}`,
      },
    ],
  };
};

export const shouldConfirmAbstention = (state: typeof HiveAIState.State) => {
  if (state.abstentionChallenged && state.attempts <= MAX_ATTEMPTS)
    return "Solver";
  return "HiveQueenResponder";
};
