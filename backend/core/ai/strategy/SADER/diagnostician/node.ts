import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { GraphNode } from "@langchain/langgraph/web";
import { ChatOllama } from "@langchain/ollama";
import z from "zod";
import { HiveMicrokernel } from "../../../../microkernel/hive-microkernel.ts";
import { HiveAIState } from "../graph.ts";
import { parseModelJSON } from "../../utils.ts";
import {
  DIAGNOSTICIAN_SYSTEM_PROMPT,
  diagnosticianHumanPrompt,
} from "./prompt.ts";

export const Diagnostician: GraphNode<typeof HiveAIState> = async (state) => {
  const start = performance.now();
  const microkernel = HiveMicrokernel.getInstance();
  const DiagnosticianResponse = z.object({
    action: z.enum(["retry", "giveUp"]),
    reason: z.string(),
  });

  const selectedPlugin = microkernel.getPlugin(state.selectedTool);

  if (!selectedPlugin) {
    return {
      giveUp: true,
      correction: { tool: state.selectedTool, reason: "Plugin no encontrado." },
      messages: [],
      steps: [
        {
          node: "Diagnostician" as const,
          label: "Diagnosticando fallo",
          durationMs: performance.now() - start,
          summary: "Plugin no encontrado",
        },
      ],
    };
  }

  const diagnosticianModel = new ChatOllama({
    model: state.model,
    think: true,
    format: z.toJSONSchema(DiagnosticianResponse),
  });

  const response = await diagnosticianModel.invoke([
    new SystemMessage(DIAGNOSTICIAN_SYSTEM_PROMPT),
    new HumanMessage(
      diagnosticianHumanPrompt(
        state.currentPrompt,
        selectedPlugin.name,
        state.args.params,
        state.toolResult.output,
      ),
    ),
  ]);

  const parsed = parseModelJSON<{
    action: "retry" | "giveUp";
    reason: string;
  }>(response.content as string);

  const durationMs = performance.now() - start;

  if (!parsed) {
    return {
      giveUp: true,
      correction: {
        tool: state.selectedTool,
        reason: "El diagnosticador no devolvió una respuesta interpretable.",
        failedArgs: state.args.params,
      },
      messages: [],
      steps: [
        {
          node: "Diagnostician" as const,
          label: "Diagnosticando fallo",
          durationMs,
          summary: "Respuesta no interpretable, se abandona el intento",
        },
      ],
    };
  }

  if (parsed.action === "giveUp") {
    return {
      giveUp: true,
      correction: {
        tool: state.selectedTool,
        reason: parsed.reason,
        failedArgs: state.args.params,
      },
      messages: [response],
      steps: [
        {
          node: "Diagnostician" as const,
          label: "Diagnosticando fallo",
          durationMs,
          summary: `Abandona: ${parsed.reason}`,
        },
      ],
    };
  }

  return {
    correction: {
      tool: state.selectedTool,
      reason: parsed.reason,
      failedArgs: state.args.params,
    },
    attempts: 1,
    messages: [],
    steps: [
      {
        node: "Diagnostician" as const,
        label: "Diagnosticando fallo",
        durationMs,
        summary: `Reintenta: ${parsed.reason}`,
      },
    ],
  };
};

export const shouldRetry = (state: typeof HiveAIState.State) => {
  if (state.giveUp) return "HiveQueenResponder";
  if (state.attempts > 1) return "HiveQueenResponder";
  return "Solver";
};
