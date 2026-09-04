import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { GraphNode } from "@langchain/langgraph/web";
import { ChatOllama } from "@langchain/ollama";
import z from "zod";
import { HiveMicrokernel } from "../../../../microkernel/hive-microkernel.ts";
import { parseModelJSON } from "../../utils.ts";
import { HiveAIState } from "../graph.ts";
import {
  ABSTENTION_VERIFICATOR_SYSTEM_PROMPT,
  abstentionVerificatorHumanPrompt,
} from "./prompt.ts";

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
    new SystemMessage(ABSTENTION_VERIFICATOR_SYSTEM_PROMPT),
    new HumanMessage(
      abstentionVerificatorHumanPrompt(state.currentPrompt, catalogSummary),
    ),
  ]);

  const parsed = parseModelJSON<{
    action: "confirm" | "challenge";
    reason: string;
    suggestedTool?: string;
  }>(response.content as string);

  const durationMs = performance.now() - start;

  if (!parsed || parsed.action === "confirm") {
    return {
      abstentionVerified: true,
      abstentionChallenged: false,
      steps: [
        {
          node: "AbstentionVerificator" as const,
          label: "Confirmando abstención",
          durationMs,
          summary: "Confirmó que no hace falta ninguna herramienta",
        },
      ],
    };
  }

  return {
    abstentionVerified: true,
    abstentionChallenged: true,
    correction: {
      tool: parsed.suggestedTool ?? "desconocida",
      reason: parsed.reason,
    },
    attempts: 1,
    selectionAttempts: 1,
    steps: [
      {
        node: "AbstentionVerificator" as const,
        label: "Confirmando abstención",
        durationMs,
        summary: `Desafió la abstención: ${parsed.reason}`,
      },
    ],
  };
};

export const shouldConfirmAbstention = (state: typeof HiveAIState.State) => {
  if (state.abstentionChallenged && state.attempts <= 1) return "Solver";
  return "HiveQueenResponder";
};
