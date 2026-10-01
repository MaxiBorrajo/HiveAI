import { HumanMessage } from "@langchain/core/messages";
import { ConditionConfig } from "../types.ts";
import { buildLlmInstance, coerceLlmBooleanReply } from "./llm-executor.ts";


export async function evaluateConditionWithFallback(
  nodeId: string,
  nodeName: string,
  cond: ConditionConfig,
  state: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    const modelName = (state.model as string);

    // temperature: 0 to keep the true/false evaluation deterministic.
    const llm = buildLlmInstance(nodeId, {
      model: modelName,
      temperature: 0,
    }) as any;

    let contextContent = "";
    if (Array.isArray(state.messages) && state.messages.length > 0) {
      const lastMsg = state.messages[state.messages.length - 1];
      contextContent =
        typeof lastMsg === "string"
          ? lastMsg
          : (lastMsg as any)?.content || JSON.stringify(lastMsg);
    } else if (typeof state.content === "string") {
      contextContent = state.content;
    } else if (state.result !== undefined) {
      contextContent =
        typeof state.result === "string"
          ? state.result
          : JSON.stringify(state.result);
    } else {
      contextContent = JSON.stringify(state);
    }

    const prompt = `Evaluate if the following condition is satisfied based on the provided context.
Condition: "${nodeName}" (${cond.field} ${cond.operator} ${JSON.stringify(cond.value)})
Context:
${contextContent.slice(0, 1500)}

Is the condition satisfied?
Reply with ONLY the word "true" or "false".`;

    const res = await llm.invoke([new HumanMessage(prompt)]);
    const isSatisfied = coerceLlmBooleanReply(String(res.content));

    let evaluatedValue: unknown = isSatisfied;
    if (cond.operator === "equals") {
      evaluatedValue = isSatisfied ? cond.value : !cond.value;
    }

    console.log(
      `[Condition Evaluator] Node "${nodeId}" evaluated missing field "${cond.field}" ->`,
      evaluatedValue,
    );
    return { [cond.field]: evaluatedValue };
  } catch (err: unknown) {
    console.warn(`[Condition Evaluator] Fallback evaluation for ${nodeId} failed:`, err);
    return {};
  }
}
