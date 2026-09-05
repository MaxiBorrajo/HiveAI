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
import { MAX_ATTEMPTS } from "../constants.ts";

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
      correction: { tool: state.selectedTool, reason: "Plugin not found." },
      messages: [],
      steps: [
        {
          node: "Diagnostician" as const,
          label: "Diagnosing failure",
          durationMs: performance.now() - start,
          summary: "Plugin not found",
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
        reason: "The diagnostician did not return an interpretable response.",
        failedArgs: state.args.params,
      },
      messages: [],
      steps: [
        {
          node: "Diagnostician" as const,
          label: "Diagnosing failure",
          durationMs,
          summary: "Uninterpretable response, abandoning attempt",
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
          label: "Diagnosing failure",
          durationMs,
          summary: `Giving up: ${parsed.reason}`,
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
        label: "Diagnosing failure",
        durationMs,
        summary: `Retrying: ${parsed.reason}`,
      },
    ],
  };
};

export const shouldRetry = (state: typeof HiveAIState.State) => {
  if (state.giveUp) return "HiveQueenResponder";
  if (state.attempts > MAX_ATTEMPTS) return "HiveQueenResponder";
  return "Solver";
};
