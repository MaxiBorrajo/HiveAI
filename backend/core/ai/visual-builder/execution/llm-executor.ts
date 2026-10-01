import { ChatOllama } from "@langchain/ollama";
import { Runnable } from "@langchain/core/runnables";
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
  ToolMessage,
  BaseMessage,
} from "@langchain/core/messages";
import { ToolProvider, LlmConfig } from "../types.ts";
import { mapTypeToZod } from "../utils.ts";

// Interprets a raw LLM text reply as a boolean. Shared by the LLM node's
// boolean-output mapping and the visual-builder condition semantic fallback,
// so both agree on what counts as "true".
export function coerceLlmBooleanReply(text: string): boolean {
  const clean = text.trim().toLowerCase();
  if (clean.startsWith("true")) return true;
  if (/\bfalse\b|\bnot\s+true\b|\buntrue\b/.test(clean)) return false;
  return /\btrue\b/.test(clean);
}

const MAX_CONTEXT_VALUE_CHARS = 4000;
const MAX_REACT_ITERATIONS = 8;
const STATE_KEYS_EXCLUDED_FROM_CONTEXT = new Set([
  "input",
  "messages",
  "feedback",
  "model",
]);

function resolveModelName(model: unknown): string {
  if (typeof model === "string") return model;
  const obj = model as { name?: string; value?: string };
  const name = obj.name || obj.value || String(model);
  return name;
}

function createChatModel(config: LlmConfig, temperature: number): ChatOllama {
  // Node-level fields must not leak into the model options.
  const {
    model,
    plugins: _plugins,
    systemPrompt: _systemPrompt,
    pluginId: _pluginId,
    structuredOutput: _structuredOutput,
    outputKey: _outputKey,
    inputMapping: _inputMapping,
    ...modelOptions
  } = config;

  return new ChatOllama({
    model: resolveModelName(model),
    temperature,
    ...modelOptions,
  });
}

function toolResultToString(toolResult: unknown): string {
  if (typeof toolResult === "string") return toolResult;
  const content = (toolResult as { content?: unknown } | null)?.content;
  return typeof content === "string" ? content : JSON.stringify(toolResult);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildLlmInstance(
  nodeId: string,
  config: LlmConfig,
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

  if (!config.model) {
    throw new Error(
      `[Compiler Native LLM] No model was specified for node '${nodeId}'.`,
    );
  }

  const llm = createChatModel(config, 0.8);
  console.log(
    `\n[Compiler Native LLM] Executing model: ${llm.model} for node ${nodeId}`,
  );
  if (toolsToBind.length > 0) {
    console.log(`[Compiler Native LLM] Tools bound: ${toolsToBind.length}`);
  }

  let runnableLlm: Runnable = llm as unknown as Runnable;

  if (toolsToBind.length > 0) {
    // @ts-expect-error LangChain typing for bindTools can be tricky across versions
    runnableLlm = llm.bindTools(toolsToBind);
  }

  if (config.structuredOutput) {
    console.log(`[Compiler Native LLM] Applying Structured Output Schema`);
    const zodSchema = mapTypeToZod(config.structuredOutput);
    // @ts-expect-error ChatOllama supports withStructuredOutput but types may mismatch Runnable
    runnableLlm = runnableLlm.withStructuredOutput(zodSchema);
  }

  return runnableLlm;
}

export function buildPromptMessages(
  state: Record<string, unknown>,
  config: LlmConfig,
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

  // If this node declares an inputMapping (label -> bare state key), it
  // REPLACES the full-state dump below with only the declared subset —
  // this is what makes a node's data dependencies explicit and auditable
  // instead of every node seeing the entire accumulated state.
  const inputMapping = config.inputMapping as
    | Record<string, string>
    | undefined;
  if (inputMapping && Object.keys(inputMapping).length > 0) {
    for (const [label, stateKey] of Object.entries(inputMapping)) {
      const resolved = state[stateKey];
      if (resolved === undefined || resolved === null) continue;
      const valStr =
        typeof resolved === "string"
          ? resolved
          : JSON.stringify(resolved, null, 2);
      contextParts.push(
        `CONTEXT [${label}]:\n${valStr.slice(0, MAX_CONTEXT_VALUE_CHARS)}`,
      );
    }
  } else {
    for (const [key, value] of Object.entries(state)) {
      if (
        !STATE_KEYS_EXCLUDED_FROM_CONTEXT.has(key) &&
        value !== undefined &&
        value !== null
      ) {
        const valStr =
          typeof value === "string" ? value : JSON.stringify(value, null, 2);
        // Include reasonable slice to prevent prompt explosion
        contextParts.push(
          `CONTEXT [${key}]:\n${valStr.slice(0, MAX_CONTEXT_VALUE_CHARS)}`,
        );
      }
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

type ToolLike = {
  name: string;
  invoke(args: unknown): Promise<unknown>;
};

function resolveTools(
  nodeId: string,
  config: LlmConfig,
  toolProvider?: ToolProvider,
): ToolLike[] {
  const requested = Array.isArray(config.plugins)
    ? config.plugins.filter((p): p is string => typeof p === "string")
    : [];
  if (requested.length === 0) return [];

  if (!toolProvider) {
    throw new Error(
      `Node '${nodeId}' requests plugins [${requested.join(", ")}], but no ToolProvider was provided.`,
    );
  }

  const tools: ToolLike[] = [];
  for (const name of requested) {
    const tool = toolProvider.getTool(name);
    if (tool) {
      tools.push(tool as unknown as ToolLike);
    } else {
      console.warn(
        `[LLM Agent Node ${nodeId}] Tool '${name}' requested but not found in ToolProvider.`,
      );
    }
  }
  return tools;
}

async function runToolCall(
  nodeId: string,
  toolCall: { name: string; args: Record<string, unknown>; id?: string },
  toolProvider?: ToolProvider,
): Promise<ToolMessage> {
  const callId = toolCall.id || `call_${crypto.randomUUID().slice(0, 8)}`;
  const tool = toolProvider?.getTool(toolCall.name);

  if (!tool) {
    return new ToolMessage({
      tool_call_id: callId,
      name: toolCall.name,
      content: `Error: Tool '${toolCall.name}' is not registered.`,
    });
  }

  try {
    console.log(
      `[LLM Agent Node ${nodeId}] Executing tool '${toolCall.name}' with args:`,
      toolCall.args,
    );
    const content = toolResultToString(await tool.invoke(toolCall.args));
    console.log(
      `[LLM Agent Node ${nodeId}] Tool '${toolCall.name}' output received (${content.length} chars).`,
    );
    return new ToolMessage({
      tool_call_id: callId,
      name: toolCall.name,
      content,
    });
  } catch (toolErr) {
    const detail = errorMessage(toolErr);
    console.error(
      `[LLM Agent Node ${nodeId}] Tool '${toolCall.name}' execution error:`,
      detail,
    );
    return new ToolMessage({
      tool_call_id: callId,
      name: toolCall.name,
      content: `Error executing tool '${toolCall.name}': ${detail}`,
    });
  }
}

/**
 * Autonomous ReAct loop: the model requests tools, we run them and feed the
 * results back until it answers without tool calls (or the iteration cap is
 * hit, in which case the last message is used as the answer).
 */
async function runReactLoop(
  nodeId: string,
  baseLlm: ChatOllama,
  tools: ToolLike[],
  messages: BaseMessage[],
  toolProvider?: ToolProvider,
): Promise<unknown> {
  console.log(
    `\n[LLM Agent Node ${nodeId}] Starting autonomous ReAct loop with tools: [${tools.map((t) => t.name).join(", ")}]`,
  );

  // deno-lint-ignore no-explicit-any
  const boundLlm = (baseLlm as any).bindTools(tools);
  const conversation: BaseMessage[] = [...messages];

  for (let iteration = 1; iteration <= MAX_REACT_ITERATIONS; iteration++) {
    console.log(
      `[LLM Agent Node ${nodeId}] Iteration #${iteration} invoking model...`,
    );

    const response = (await boundLlm.invoke(conversation)) as AIMessage;
    conversation.push(response);

    const toolCalls = response.tool_calls ?? [];
    if (toolCalls.length === 0) {
      console.log(
        `[LLM Agent Node ${nodeId}] Agent reached conclusion after ${iteration} iterations.`,
      );
      return response;
    }

    console.log(
      `[LLM Agent Node ${nodeId}] Agent requested ${toolCalls.length} tool call(s):`,
      toolCalls
        .map((tc) => `${tc.name}(${JSON.stringify(tc.args)})`)
        .join(", "),
    );

    for (const toolCall of toolCalls) {
      conversation.push(await runToolCall(nodeId, toolCall, toolProvider));
    }
  }

  return conversation[conversation.length - 1];
}

/**
 * Executes an LLM node. Without plugins it is a single model call; with
 * plugins it runs an autonomous ReAct tool loop. Failures propagate so the
 * run is reported as failed instead of feeding placeholder text downstream.
 */
export async function executeLlmNode(
  nodeId: string,
  config: LlmConfig,
  state: Record<string, unknown>,
  toolProvider?: ToolProvider,
): Promise<Record<string, unknown>> {
  try {
    const tools = resolveTools(nodeId, config, toolProvider);
    const baseLlm = createChatModel(config, 0.2);
    const messages = buildPromptMessages(state, config);

    if (tools.length > 0) {
      const finalResponse = await runReactLoop(
        nodeId,
        baseLlm,
        tools,
        messages,
        toolProvider,
      );
      return mapResponseToState(finalResponse, config, state);
    }

    let runnable: Runnable = baseLlm as unknown as Runnable;
    if (config.structuredOutput) {
      // deno-lint-ignore no-explicit-any
      runnable = (baseLlm as any).withStructuredOutput(
        mapTypeToZod(config.structuredOutput),
      );
    }
    const response = await runnable.invoke(messages);
    return mapResponseToState(response, config, state);
  } catch (err: unknown) {
    throw new Error(`LLM node '${nodeId}' failed: ${errorMessage(err)}`, {
      cause: err,
    });
  }
}

export function mapResponseToState(
  response: unknown,
  config: LlmConfig,
  state: Record<string, unknown>,
): Record<string, unknown> {
  let resultValue: unknown;

  if (config.structuredOutput) {
    resultValue = response;
  } else {
    resultValue = (response as AIMessage).content;
  }

  const outKey = config.outputKey;
  const isBooleanField = config.structuredOutput?.type === "boolean";

  if (isBooleanField) {
    if (typeof resultValue === "boolean") {
      // already a boolean primitive
    } else if (typeof resultValue === "string") {
      resultValue = coerceLlmBooleanReply(resultValue);
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
