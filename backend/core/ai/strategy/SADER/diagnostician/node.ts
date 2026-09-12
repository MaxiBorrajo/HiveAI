import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { GraphNode } from "@langchain/langgraph/web";
import { ChatOllama } from "@langchain/ollama";
import z from "zod";
import { HiveMicrokernel } from "../../../../microkernel/hive-microkernel.ts";
import { HiveAIState, type ChatStep } from "../graph.ts";
import { parseModelJSON } from "../../shared/utils.ts";
import {
  DIAGNOSTICIAN_SYSTEM_PROMPT,
  diagnosticianHumanPrompt,
} from "./prompt.ts";
import { MAX_ATTEMPTS } from "../constants.ts";
import { getNativeTool } from "../../shared/native-tools.ts";

const DiagnosticianResponse = z.object({
  action: z.enum(["retry", "giveUp"]),
  reason: z.string(),
});

export const Diagnostician: GraphNode<typeof HiveAIState> = async (state) => {
  const start = performance.now();
  const microkernel = HiveMicrokernel.getInstance();
  const failedResults = state.toolResults.filter((r) => !r.ok);

  const diagnosticianOptions = {
    model: state.model,
    think: true,
    format: z.toJSONSchema(DiagnosticianResponse),
    ...state.modelOptions,
  };
  const diagnosticianModel = new ChatOllama(diagnosticianOptions);

  console.log(
    `[SADER - Diagnostician] Effective Ollama options:`,
    diagnosticianOptions,
  );

  const corrections: {
    tool: string;
    reason: string;
    failedArgs?: Record<string, unknown>;
  }[] = [];
  const steps: ChatStep[] = [];
  let giveUp = false;

  for (const failed of failedResults) {
    const knownTool =
      microkernel.getPlugin(failed.tool) ??
      getNativeTool(failed.tool, state.chatId);

    if (!knownTool) {
      giveUp = true;
      corrections.push({ tool: failed.tool, reason: "Plugin not found." });
      steps.push({
        node: "Diagnostician" as const,
        label: "Diagnosing failure",
        durationMs: 0,
        summary: `Plugin "${failed.tool}" not found`,
      });
      continue;
    }

    console.log(
      `\n[SADER - Diagnostician] Starting diagnosis for plugin "${failed.tool}"`,
    );
    console.log(
      `[SADER - Diagnostician] Plugin output to diagnose:`,
      failed.output,
    );

    const stepStart = performance.now();

    const response = await diagnosticianModel.invoke([
      new SystemMessage(DIAGNOSTICIAN_SYSTEM_PROMPT),
      new HumanMessage(
        diagnosticianHumanPrompt(
          state.currentPrompt,
          knownTool.name,
          failed.args,
          failed.output,
        ),
      ),
    ]);

    console.log(
      `[SADER - Diagnostician] Raw model response:`,
      response.content,
    );

    const parsed = parseModelJSON<{
      action: "retry" | "giveUp";
      reason: string;
    }>(response.content as string, "Diagnostician");

    console.log(`[SADER - Diagnostician] Parsed diagnosis result:`, parsed);

    const durationMs = performance.now() - stepStart;

    if (!parsed) {
      giveUp = true;
      corrections.push({
        tool: failed.tool,
        reason: "The diagnostician did not return an interpretable response.",
        failedArgs: failed.args,
      });
      steps.push({
        node: "Diagnostician" as const,
        label: "Diagnosing failure",
        durationMs,
        summary: "Uninterpretable response, abandoning attempt",
      });
      continue;
    }

    if (parsed.action === "giveUp") {
      giveUp = true;
      corrections.push({
        tool: failed.tool,
        reason: parsed.reason,
        failedArgs: failed.args,
      });
      steps.push({
        node: "Diagnostician" as const,
        label: "Diagnosing failure",
        durationMs,
        summary: `Giving up on "${failed.tool}": ${parsed.reason}`,
      });
      continue;
    }

    corrections.push({
      tool: failed.tool,
      reason: parsed.reason,
      failedArgs: failed.args,
    });
    steps.push({
      node: "Diagnostician" as const,
      label: "Diagnosing failure",
      durationMs,
      summary: `Retrying "${failed.tool}": ${parsed.reason}`,
    });
  }

  return {
    giveUp,
    corrections,
    attempts: 1,
    messages: [],
    steps,
  };
};

export const shouldRetry = (state: typeof HiveAIState.State) => {
  if (state.giveUp) return "HiveQueenResponder";
  if (state.attempts > MAX_ATTEMPTS) return "HiveQueenResponder";
  return "Solver";
};
