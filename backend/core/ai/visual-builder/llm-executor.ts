import { ChatOllama } from "@langchain/ollama";
import { Runnable } from "@langchain/core/runnables";
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
  ToolMessage,
  BaseMessage,
} from "@langchain/core/messages";
import { ToolProvider, StatePropertyDefinition } from "./types.ts";
import { mapTypeToZod } from "./utils.ts";

export function buildLlmInstance(
  nodeId: string,
  config: Record<string, unknown>,
  toolProvider?: ToolProvider,
): Runnable {
  const toolsToBind: unknown[] = [];

  if (config.plugins && Array.isArray(config.plugins)) {
    if (!toolProvider) {
      throw new Error(
        `Node ${nodeId} requests plugins, but no ToolProvider was injected into compileGraph.`,
      );
    }

    for (const pluginName of config.plugins) {
      const tool = toolProvider.getTool(pluginName);
      if (!tool) {
        throw new Error(
          `Plugin '${pluginName}' was requested by node '${nodeId}' but is not registered in the Microkernel.`,
        );
      }
      toolsToBind.push(tool);
    }
  }

  const {
    model,
    plugins,
    systemPrompt,
    pluginId,
    structuredOutput,
    outputKey,
    ...customLlmConfig
  } = config;

  if (!model) {
    throw new Error(
      `[Compiler Native LLM] No model was specified for node '${nodeId}'.`,
    );
  }
  let modelName = typeof model === "string" ? model : (model as any).name || (model as any).value || String(model);
  if (modelName === "[object Object]") {
    // Ultimate fallback if it generated a weird object
    modelName = "qwen3:1.7b";
  }

  console.log(
    `\n[Compiler Native LLM] Executing model: ${modelName} for node ${nodeId}`,
  );
  if (toolsToBind.length > 0) {
    console.log(`[Compiler Native LLM] Tools bound: ${toolsToBind.length}`);
  }

  const llm = new ChatOllama({
    model: modelName,
    temperature: 0.8,
    ...customLlmConfig,
  });

  let runnableLlm: Runnable = llm as unknown as Runnable;

  if (toolsToBind.length > 0) {
    // @ts-expect-error LangChain typing for bindTools can be tricky across versions
    runnableLlm = llm.bindTools(toolsToBind);
  }

  if (structuredOutput) {
    console.log(`[Compiler Native LLM] Applying Structured Output Schema`);
    const zodSchema = mapTypeToZod(structuredOutput as StatePropertyDefinition);
    // @ts-expect-error ChatOllama supports withStructuredOutput but types may mismatch Runnable
    runnableLlm = runnableLlm.withStructuredOutput(zodSchema);
  }

  return runnableLlm;
}

export function buildPromptMessages(
  state: Record<string, unknown>,
  config: Record<string, unknown>,
): BaseMessage[] {
  const messagesToSend: BaseMessage[] = [];

  if (config.systemPrompt) {
    messagesToSend.push(new SystemMessage(config.systemPrompt as string));
  }

  if (state.feedback) {
    messagesToSend.push(
      new HumanMessage(
        `SYSTEM NOTE - PLEASE CONSIDER THIS FEEDBACK: ${state.feedback}`,
      ),
    );
  }

  if (state.messages && Array.isArray(state.messages)) {
    for (const msg of state.messages) {
      if (
        msg &&
        typeof msg === "object" &&
        (msg as Record<string, unknown>).role &&
        (msg as Record<string, unknown>).content
      ) {
        const role = (msg as Record<string, unknown>).role;
        const content = (msg as Record<string, unknown>).content as string;
        if (role === "system") {
          messagesToSend.push(new SystemMessage(content));
        } else if (role === "assistant") {
          messagesToSend.push(new AIMessage(content));
        } else {
          messagesToSend.push(new HumanMessage(content));
        }
      }
    }
  }

  // Format contextual state data (input, variables created by previous steps)
  const contextParts: string[] = [];
  if (state.input && typeof state.input === "string") {
    contextParts.push(`USER GOAL / INPUT:\n${state.input}`);
  }

  for (const [key, value] of Object.entries(state)) {
    if (
      key !== "input" &&
      key !== "messages" &&
      key !== "feedback" &&
      key !== "model" &&
      value !== undefined &&
      value !== null
    ) {
      const valStr =
        typeof value === "string" ? value : JSON.stringify(value, null, 2);
      // Include reasonable slice to prevent prompt explosion
      contextParts.push(`CONTEXT [${key}]:\n${valStr.slice(0, 4000)}`);
    }
  }

  const hasHumanMessage = messagesToSend.some((m) => m instanceof HumanMessage);
  if (!hasHumanMessage) {
    if (contextParts.length > 0) {
      messagesToSend.push(new HumanMessage(contextParts.join("\n\n")));
    } else {
      messagesToSend.push(
        new HumanMessage(
          "Please execute the designated task following the instructions.",
        ),
      );
    }
  } else if (contextParts.length > 0) {
    // If state context exists, inject it as supplementary context
    messagesToSend.push(
      new HumanMessage(
        `CURRENT MEMORY STATE CONTEXT:\n${contextParts.join("\n\n")}`,
      ),
    );
  }

  return messagesToSend;
}

/**
 * Executes an LLM node. If plugins are assigned, it executes an autonomous ReAct
 * tool loop (up to maxTurns turns), invoking the tools and feeding back the results
 * so the agent can read multiple URLs, compute, or search iteratively.
 */
export async function executeLlmNode(
  nodeId: string,
  config: Record<string, unknown>,
  state: Record<string, unknown>,
  toolProvider?: ToolProvider,
): Promise<Record<string, unknown>> {
  try {
    const rawPlugins = config.plugins;
    const requestedPlugins: string[] = Array.isArray(rawPlugins)
      ? rawPlugins.filter((p): p is string => typeof p === "string")
      : [];

    const toolsToBind: any[] = [];
    if (requestedPlugins.length > 0) {
      if (!toolProvider) {
        throw new Error(
          `Node '${nodeId}' requests plugins [${requestedPlugins.join(", ")}], but no ToolProvider was provided.`,
        );
      }
      for (const pName of requestedPlugins) {
        const tool = toolProvider.getTool(pName);
        if (tool) {
          toolsToBind.push(tool);
        } else {
          console.warn(
            `[LLM Agent Node ${nodeId}] Tool '${pName}' requested but not found in ToolProvider.`,
          );
        }
      }
    }

    const {
      model,
      plugins,
      systemPrompt,
      pluginId,
      structuredOutput,
      outputKey,
      ...customLlmConfig
    } = config;

    let modelName =
      typeof model === "string"
        ? model
        : (model as any)?.name || (model as any)?.value || String(model || "qwen3:8b");
    if (modelName === "[object Object]") {
      modelName = "qwen3:8b";
    }

    const baseLlm = new ChatOllama({
      model: modelName,
      temperature: 0.2,
      ...customLlmConfig,
    });

    const messages = buildPromptMessages(state, config);

    // Case 1: Simple LLM (No tools assigned)
    if (toolsToBind.length === 0) {
      let runnable: Runnable = baseLlm as unknown as Runnable;
      if (structuredOutput) {
        const zodSchema = mapTypeToZod(
          structuredOutput as StatePropertyDefinition,
        );
        runnable = (baseLlm as any).withStructuredOutput(zodSchema);
      }
      const response = await runnable.invoke(messages);
      return mapResponseToState(response, config, state);
    }

    // Case 2: Autonomous AI Agent Node (ReAct Tool Loop)
    console.log(
      `\n[LLM Agent Node ${nodeId}] Starting autonomous ReAct loop with tools: [${toolsToBind.map((t) => t.name).join(", ")}]`,
    );

    const boundLlm = (baseLlm as any).bindTools(toolsToBind);
    const conversation: BaseMessage[] = [...messages];
    const maxIterations = 8;
    let iteration = 0;
    let finalResponse: unknown = null;

    while (iteration < maxIterations) {
      iteration++;
      console.log(
        `[LLM Agent Node ${nodeId}] Iteration #${iteration} invoking model...`,
      );

      const response = (await boundLlm.invoke(conversation)) as AIMessage;
      conversation.push(response);

      const toolCalls = (response as any).tool_calls as
        | Array<{ name: string; args: Record<string, unknown>; id?: string }>
        | undefined;

      if (!toolCalls || toolCalls.length === 0) {
        console.log(
          `[LLM Agent Node ${nodeId}] Agent reached conclusion after ${iteration} iterations.`,
        );
        finalResponse = response;
        break;
      }

      console.log(
        `[LLM Agent Node ${nodeId}] Agent requested ${toolCalls.length} tool call(s):`,
        toolCalls.map((tc) => `${tc.name}(${JSON.stringify(tc.args)})`).join(", "),
      );

      for (const tc of toolCalls) {
        const tool = toolProvider?.getTool(tc.name);
        const callId = tc.id || `call_${crypto.randomUUID().slice(0, 8)}`;

        if (!tool) {
          conversation.push(
            new ToolMessage({
              tool_call_id: callId,
              name: tc.name,
              content: `Error: Tool '${tc.name}' is not registered.`,
            }),
          );
          continue;
        }

        try {
          console.log(
            `[LLM Agent Node ${nodeId}] Executing tool '${tc.name}' with args:`,
            tc.args,
          );
          const toolResult = await tool.invoke(tc.args);
          const contentStr =
            typeof toolResult === "string"
              ? toolResult
              : typeof (toolResult as any)?.content === "string"
                ? (toolResult as any).content
                : JSON.stringify(toolResult);

          console.log(
            `[LLM Agent Node ${nodeId}] Tool '${tc.name}' output received (${contentStr.length} chars).`,
          );

          conversation.push(
            new ToolMessage({
              tool_call_id: callId,
              name: tc.name,
              content: contentStr,
            }),
          );
        } catch (toolErr) {
          const errMsg =
            toolErr instanceof Error ? toolErr.message : String(toolErr);
          console.error(
            `[LLM Agent Node ${nodeId}] Tool '${tc.name}' execution error:`,
            errMsg,
          );
          conversation.push(
            new ToolMessage({
              tool_call_id: callId,
              name: tc.name,
              content: `Error executing tool '${tc.name}': ${errMsg}`,
            }),
          );
        }
      }
    }

    if (!finalResponse) {
      finalResponse = conversation[conversation.length - 1];
    }

    return mapResponseToState(finalResponse, config, state);
  } catch (err: unknown) {
    return handleLlmError(err, nodeId, config);
  }
}

export function mapResponseToState(
  response: unknown,
  config: Record<string, unknown>,
  state: Record<string, unknown>,
): Record<string, unknown> {
  let resultValue: unknown;

  if (config.structuredOutput) {
    resultValue = response;
  } else {
    resultValue = (response as AIMessage).content;
  }

  const outKey = config.outputKey as string | undefined;
  const isBooleanField =
    (config.structuredOutput as any)?.type === "boolean" ||
    (outKey &&
      (outKey.startsWith("is_") ||
        outKey.endsWith("_valid") ||
        outKey.endsWith("_approved")));

  if (isBooleanField) {
    if (typeof resultValue === "boolean") {
      // already a boolean primitive
    } else if (typeof resultValue === "string") {
      const clean = resultValue.trim().toLowerCase();
      resultValue =
        clean === "true" ||
        clean.startsWith("true") ||
        clean.includes("is_valid: true") ||
        clean.includes("is_valid\": true") ||
        clean.includes("true");
    } else if (typeof resultValue === "object" && resultValue !== null) {
      const firstVal = Object.values(resultValue)[0];
      if (typeof firstVal === "boolean") {
        resultValue = firstVal;
      } else {
        const clean = String(firstVal).trim().toLowerCase();
        resultValue = clean === "true" || clean.startsWith("true");
      }
    } else {
      resultValue = Boolean(resultValue);
    }
  }

  const stateUpdate: Record<string, unknown> = {};

  if (outKey) {
    stateUpdate[outKey] = resultValue;
    // Guarantee state.result is always populated for any primary content node
    if (outKey !== "result" && !isBooleanField) {
      stateUpdate.result = resultValue;
    }
  } else {
    if (typeof resultValue === "string") {
      stateUpdate.messages = [{ role: "assistant", content: resultValue }];
      stateUpdate.result = resultValue;
    } else {
      stateUpdate.result = resultValue;
    }
  }

  if (state.attempts !== undefined) {
    stateUpdate.attempts = 1;
  }

  return stateUpdate;
}

export function handleLlmError(
  error: unknown,
  nodeId: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const errorMsg = error instanceof Error ? error.message : String(error);
  console.error(
    `[Compiler Native LLM] Network error with Ollama (Node ${nodeId}):`,
    errorMsg,
  );

  const resultValue = config.structuredOutput
    ? { error: `Mock Fallback due to error: ${errorMsg}` }
    : `(Mock Fallback due to connection error: ${errorMsg})`;

  const stateUpdate: Record<string, unknown> = {};
  if (config.outputKey) {
    stateUpdate[config.outputKey as string] = resultValue;
  } else {
    if (typeof resultValue === "string") {
      stateUpdate.messages = [{ role: "assistant", content: resultValue }];
    } else {
      stateUpdate.result = resultValue;
    }
  }

  return stateUpdate;
}
