import { ChatOllama } from "@langchain/ollama";
import { Runnable } from "@langchain/core/runnables";
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
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

  if (messagesToSend.length === 0) {
    messagesToSend.push(new HumanMessage("Hello."));
  }

  return messagesToSend;
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
