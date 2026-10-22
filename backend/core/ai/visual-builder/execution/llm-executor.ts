import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { createChatModel } from "../../providers/create-chat-model.ts";
import { normalizeModelRef, isCloudProvider } from "../../providers/types.ts";
import { normalizeProviderError } from "../../providers/errors.ts";
import { Runnable } from "@langchain/core/runnables";
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
  ToolMessage,
  BaseMessage,
} from "@langchain/core/messages";
import { ToolProvider, LlmConfig } from "../types.ts";
import { mapTypeToZod } from "./state.ts";
import { withLocalNumCtx } from "../../providers/local-context.ts";
import { splitContent } from "../../providers/capabilities.ts";

export function coerceLlmBooleanReply(text: string): boolean {
  const clean = text.trim().toLowerCase();
  if (clean.startsWith("true")) return true;
  if (/\bfalse\b|\bnot\s+true\b|\buntrue\b/.test(clean)) return false;
  return /\btrue\b/.test(clean);
}

const MAX_REACT_ITERATIONS = 8;
const STATE_KEYS_EXCLUDED_FROM_CONTEXT = new Set([
  "input",
  "messages",
  "feedback",
  "model",
  "attachments",
]);

interface AttachmentContentPart {
  type: "text" | "image";
  text?: string;
  mimeType?: string;
  data?: string;
}

function toLangchainImageUrl(part: AttachmentContentPart): string {
  return `data:${part.mimeType};base64,${part.data}`;
}

function buildHumanMessage(
  text: string,
  attachmentParts: AttachmentContentPart[],
): HumanMessage {
  if (attachmentParts.length === 0) return new HumanMessage(text);

  const content: Array<Record<string, unknown>> = [{ type: "text", text }];
  for (const part of attachmentParts) {
    if (part.type === "image") {
      content.push({
        type: "image_url",
        image_url: { url: toLangchainImageUrl(part) },
      });
    } else if (part.type === "text" && part.text) {
      content.push({ type: "text", text: part.text });
    }
  }
  return new HumanMessage({ content: content as unknown as BaseMessage["content"] });
}

function resolveModelName(model: unknown): string {
  if (typeof model === "string") return model;
  const obj = model as { name?: string; value?: string };
  const name = obj.name || obj.value || String(model);
  return name;
}

function splitModelConfig(config: LlmConfig, temperature: number) {
  const {
    model,
    provider,
    keyId,
    plugins: _plugins,
    systemPrompt: _systemPrompt,
    pluginId: _pluginId,
    structuredOutput: _structuredOutput,
    outputKey: _outputKey,
    inputMapping: _inputMapping,
    maxTokens,
    ...modelOptions
  } = config;

  const ref = normalizeModelRef(resolveModelName(model), { provider, keyId });
  const outputLimit = typeof maxTokens === "number" && maxTokens > 0 ? maxTokens : undefined;
  const options = isCloudProvider(ref.provider)
    ? { temperature, ...(outputLimit ? { maxTokens: outputLimit } : {}) }
    : { temperature, numPredict: outputLimit ?? -1, ...modelOptions };
  return { ref, options };
}

async function buildNodeChatModel(
  config: LlmConfig,
  temperature: number,
): Promise<BaseChatModel> {
  const { ref, options } = splitModelConfig(config, temperature);
  return createChatModel(ref, await withLocalNumCtx(ref.provider, ref.model, options));
}

function toolResultToString(toolResult: unknown): string {
  if (typeof toolResult === "string") return toolResult;
  const content = (toolResult as { content?: unknown } | null)?.content;
  return typeof content === "string" ? content : JSON.stringify(toolResult);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function buildLlmInstance(
  nodeId: string,
  config: LlmConfig,
  toolProvider?: ToolProvider,
): Promise<Runnable> {
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

  const llm = (await buildNodeChatModel(config, 0.8)) as BaseChatModel & { model?: string };
  console.log(
    `\n[Compiler Native LLM] Executing model: ${config.model} for node ${nodeId}`,
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

export function interpolateState(
  template: string,
  state: Record<string, unknown>,
): string {
  return template.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name) => {
    const value = state[name];
    if (value === undefined || value === null) return match;
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  });
}

export function buildPromptMessages(
  state: Record<string, unknown>,
  config: LlmConfig,
): BaseMessage[] {
  const messagesToSend: BaseMessage[] = [];

  if (config.systemPrompt) {
    messagesToSend.push(
      new SystemMessage(interpolateState(config.systemPrompt as string, state)),
    );
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

  const contextParts: string[] = [];
  if (state.input && typeof state.input === "string") {
    contextParts.push(`USER GOAL / INPUT:\n${state.input}`);
  }
  const inputMapping = config.inputMapping as
    | Record<string, string>
    | undefined;
  if (inputMapping && Object.keys(inputMapping).length > 0) {
    for (const [label, stateKey] of Object.entries(inputMapping)) {
      // "attachments" is rendered as real image/text content parts below,
      // not as a JSON blob — skip it here regardless of what label the
      // node's inputMapping gave it.
      if (stateKey === "attachments") continue;
      const resolved = state[stateKey];
      if (resolved === undefined || resolved === null) continue;
      const valStr =
        typeof resolved === "string"
          ? resolved
          : JSON.stringify(resolved, null, 2);
      contextParts.push(
        `CONTEXT [${label}]:\n${valStr}`,
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
        contextParts.push(
          `CONTEXT [${key}]:\n${valStr}`,
        );
      }
    }
  }

  const attachmentParts = Array.isArray(state.attachments)
    ? (state.attachments as AttachmentContentPart[])
    : [];

  const hasHumanMessage = messagesToSend.some((m) => m instanceof HumanMessage);
  if (!hasHumanMessage) {
    const text =
      contextParts.length > 0
        ? contextParts.join("\n\n")
        : "Please execute the designated task following the instructions.";
    messagesToSend.push(buildHumanMessage(text, attachmentParts));
  } else if (contextParts.length > 0 || attachmentParts.length > 0) {
    const text =
      contextParts.length > 0
        ? `CURRENT MEMORY STATE CONTEXT:\n${contextParts.join("\n\n")}`
        : "See the attached file(s).";
    messagesToSend.push(buildHumanMessage(text, attachmentParts));
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

async function runReactLoop(
  nodeId: string,
  baseLlm: BaseChatModel,
  tools: ToolLike[],
  messages: BaseMessage[],
  toolProvider?: ToolProvider,
): Promise<{ conversation: BaseMessage[]; final: AIMessage | null }> {
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
      return { conversation, final: response };
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

  console.warn(
    `[LLM Agent Node ${nodeId}] Tool iteration budget (${MAX_REACT_ITERATIONS}) exhausted; forcing a final answer without tools.`,
  );
  return { conversation, final: null };
}

// Anthropic thinking blocks are signed against the exact tools list of the
// request that produced them; the forced final call drops the tools, so the
// signatures would be rejected. Strip them from the replayed conversation.
function stripThinkingBlocks(conversation: BaseMessage[]): BaseMessage[] {
  return conversation.map((msg) => {
    if (!AIMessage.isInstance(msg) || !Array.isArray(msg.content)) return msg;
    const content = msg.content.filter(
      (block) =>
        typeof block !== "object" ||
        (block.type !== "thinking" && block.type !== "redacted_thinking"),
    );
    if (content.length === msg.content.length) return msg;
    return new AIMessage({
      content,
      tool_calls: msg.tool_calls,
      additional_kwargs: msg.additional_kwargs,
      response_metadata: msg.response_metadata,
      id: msg.id,
    });
  });
}

const FORCE_FINAL_ANSWER_PROMPT =
  "You have no more tool calls available. Using only the information gathered above, write your final answer now, following the output format from your instructions. Do not request any tools.";

function resolveModelOptions(config: LlmConfig, temperature: number) {
  const { ref, options } = splitModelConfig(config, temperature);
  return {
    model: ref.model,
    provider: ref.provider,
    keyId: ref.keyId,
    ...options,
  };
}

export async function executeLlmNode(
  nodeId: string,
  config: LlmConfig,
  state: Record<string, unknown>,
  toolProvider?: ToolProvider,
  llmFactory: (opts: {
    model: string;
    provider: string;
    keyId?: string;
    temperature: number;
    [key: string]: unknown;
  }) => any = ({ model, provider, keyId, ...options }) =>
    (async () => {
      const ref = normalizeModelRef(model, { provider, keyId });
      return createChatModel(
        ref,
        await withLocalNumCtx(ref.provider, ref.model, options as Record<string, unknown>),
      );
    })(),
): Promise<Record<string, unknown>> {
  try {
    const tools = resolveTools(nodeId, config, toolProvider);
    const baseLlm = await llmFactory(resolveModelOptions(config, 0.2));
    const messages = buildPromptMessages(state, config);

    if (tools.length > 0) {
      const { conversation, final } = await runReactLoop(
        nodeId,
        baseLlm,
        tools,
        messages,
        toolProvider,
      );
      if (config.structuredOutput) {
        // deno-lint-ignore no-explicit-any
        const structured = (baseLlm as any).withStructuredOutput(
          mapTypeToZod(config.structuredOutput),
        ) as Runnable;
        const parsed = await structured.invoke([
          ...stripThinkingBlocks(conversation),
          new HumanMessage(FORCE_FINAL_ANSWER_PROMPT),
        ]);
        return mapResponseToState(parsed, config, state);
      }
      const finalResponse =
        final ??
        (await baseLlm.invoke([
          ...stripThinkingBlocks(conversation),
          new HumanMessage(FORCE_FINAL_ANSWER_PROMPT),
        ]));
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
    return handleLlmError(err, nodeId, config);
  }
}

function coerceStructuredScalar(value: unknown, type: string): unknown {
  if (type !== "number" && type !== "string") return value;
  let v = value;
  if (v instanceof AIMessage) {
    v = Array.isArray(v.content) ? splitContent(v.content).text : v.content;
  }
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    const values = Object.values(v);
    if (values.length === 1) v = values[0];
  }
  if (type === "number" && typeof v === "string") {
    const m = v.match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : v;
  }
  return v;
}

export function mapResponseToState(
  response: unknown,
  config: LlmConfig,
  state: Record<string, unknown>,
): Record<string, unknown> {
  let resultValue: unknown;

  if (config.structuredOutput) {
    resultValue = coerceStructuredScalar(response, config.structuredOutput.type);
  } else {
    const content = (response as AIMessage).content;
    resultValue = Array.isArray(content) ? splitContent(content).text : content;
  }

  const outKey = config.outputKey;
  const isBooleanField =
    config.structuredOutput?.type === "boolean" ||
    (outKey &&
      (outKey.startsWith("is_") ||
        outKey.endsWith("_valid") ||
        outKey.endsWith("_approved")));

  if (isBooleanField) {
    if (typeof resultValue === "boolean") {
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
  config: LlmConfig,
): never {
  const errorMsg = normalizeProviderError(
    error,
    typeof config.provider === "string" ? config.provider : undefined,
  ).message;
  console.error(
    `[Compiler Native LLM] Model error (Node ${nodeId}):`,
    errorMsg,
  );
  throw new Error(errorMsg, { cause: error });
}
