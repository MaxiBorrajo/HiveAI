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

  const catalogSummary = microkernel
    .getRegisteredPlugins()
    .map((c) => `- ${c.name}: ${c.description}`)
    .join("\n");

  const verificatorModel = new ChatOllama({
    model: state.model,
    think: true,
    format: z.toJSONSchema(AbstentionVerificatorResponse),
  });

  const response = await verificatorModel.invoke([
    new SystemMessage(buildAbstentionVerificatorSystemPrompt()),
    new HumanMessage(
      abstentionVerificatorHumanPrompt(state.currentPrompt, catalogSummary),
    ),
  ]);

  console.log("RAW VERIFICATOR RESPONSE:", JSON.stringify(response.content));

  const parsed = parseModelJSON<{
    action: "confirm" | "challenge";
    reason: string;
    suggestedTool?: string;
  }>(response.content as string);

  console.log("PARSED VERIFICATOR RESULT:", parsed);

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

  const suggestedPlugin = parsed.suggestedTool
    ? microkernel.getPlugin(parsed.suggestedTool)
    : undefined;

  if (!suggestedPlugin) {
    return {
      abstentionVerified: true,
      abstentionChallenged: false,
      steps: [
        {
          node: "AbstentionVerificator" as const,
          label: "Confirming abstention",
          durationMs,
          summary: `Challenge rejected: suggested tool "${parsed.suggestedTool ?? "none"}" is not in the catalog`,
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
  if (state.abstentionChallenged && state.attempts <= MAX_ATTEMPTS) return "Solver";
  return "HiveQueenResponder";
};
