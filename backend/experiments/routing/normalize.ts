import type {
  AIMessageChunk,
  MessageStructure,
  MessageToolSet,
} from "@langchain/core/messages";

export interface NormalizedResult {
  selected_plugin: string | null;
  params: Record<string, unknown> | null;
  abstained: boolean;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
  invocations: number;
  format_error: boolean;
  multiple_tool_calls: boolean;
  raw: unknown;
}

export function normalize(
  rawResult: AIMessageChunk<MessageStructure<MessageToolSet>>,
): NormalizedResult {
  const result: NormalizedResult = {
    selected_plugin: null,
    params: null,
    abstained: false,
    input_tokens: 0,
    output_tokens: 0,
    duration_ms: 0,
    invocations: 0,
    format_error: false,
    multiple_tool_calls: false,
    raw: rawResult,
  };

  const messages: AIMessageChunk<MessageStructure<MessageToolSet>>[] = [];

  const isToolCalling = (
    obj: AIMessageChunk<MessageStructure<MessageToolSet>>,
  ) =>
    obj &&
    typeof obj === "object" &&
    ("tool_calls" in obj || "invalid_tool_calls" in obj);

  if (isToolCalling(rawResult)) {
    processToolCalling(rawResult, result, messages);
  } else if (
    Array.isArray(rawResult) &&
    rawResult.length > 0 &&
    isToolCalling(rawResult[0])
  ) {
    processToolCalling(rawResult[0], result, messages);
  } else {
    processPipeline(rawResult, result, messages);
  }

  for (const msg of messages) {
    if (msg?.usage_metadata) {
      result.input_tokens += msg.usage_metadata.input_tokens || 0;
      result.output_tokens += msg.usage_metadata.output_tokens || 0;
    }
    if (msg?.response_metadata?.total_duration) {
      result.duration_ms +=
        (msg.response_metadata.total_duration as number) / 1_000_000;
    }
  }

  return result;
}

function processToolCalling(
  msg: AIMessageChunk<MessageStructure<MessageToolSet>>,
  result: NormalizedResult,
  messages: AIMessageChunk<MessageStructure<MessageToolSet>>[],
) {
  messages.push(msg);
  result.invocations = 1;

  const invalidCalls = msg.invalid_tool_calls || [];
  const validCalls = msg.tool_calls || [];

  if (invalidCalls.length > 0 && validCalls.length === 0) {
    result.format_error = true;
    return;
  }

  if (validCalls.length === 0) {
    result.abstained = true;
    return;
  }

  if (validCalls.length > 1) {
    result.multiple_tool_calls = true;
  }

  result.selected_plugin = validCalls[0].name;
  result.params = validCalls[0].args;
}

function processPipeline(
  rawResult: AIMessageChunk<MessageStructure<MessageToolSet>>,
  result: NormalizedResult,
  messages: AIMessageChunk<MessageStructure<MessageToolSet>>[],
) {
  const steps = Array.isArray(rawResult) ? rawResult : [rawResult];
  result.invocations = steps.length;

  for (const step of steps) {
    if (step && step.raw) {
      messages.push(step.raw);
    }
  }

  if (steps.length === 0) {
    result.format_error = true;
    return;
  }

  const selectorStep = steps[0];

  if (!selectorStep || !selectorStep.parsed) {
    result.format_error = true;
    return;
  }

  if (selectorStep.parsed === "NINGUNO_APLICA") {
    result.abstained = true;
    return;
  }

  result.selected_plugin = selectorStep.parsed;

  if (steps.length > 1) {
    const paramStep = steps[1];
    if (!paramStep || !paramStep.parsed) {
      result.format_error = true;
      result.selected_plugin = null;
    } else {
      result.params = paramStep.parsed;
    }
  } else {
    result.format_error = true;
    result.selected_plugin = null;
  }
}
