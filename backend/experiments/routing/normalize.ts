import type { AIMessage } from "@langchain/core/messages";
import type { PipelineResult } from "./strategies/pipeline.ts";
import type { PEVResult } from "./strategies/plan-execution-verification.ts";

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
  selection_attempts_final?: number;
  parametrizer_attempts_final?: number;
  raw: unknown;
}

const isPipelineResult = (r: unknown): r is PipelineResult =>
  typeof r === "object" && r !== null && "selectorRaw" in r;

const isPEVResult = (r: unknown): r is PEVResult =>
  typeof r === "object" && r !== null && "selectedTool" in r;

function accumulate(
  messages: (AIMessage | null)[],
  result: NormalizedResult,
): void {
  for (const msg of messages) {
    if (!msg) continue;
    result.input_tokens += msg.usage_metadata?.input_tokens ?? 0;
    result.output_tokens += msg.usage_metadata?.output_tokens ?? 0;
    const duration = msg.response_metadata?.total_duration as number | undefined;
    result.duration_ms += (duration ?? 0) / 1_000_000;
  }
}

export function normalize(
  raw: AIMessage | PipelineResult | PEVResult,
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
    raw,
  };

  if (isPipelineResult(raw)) {
    accumulate([raw.selectorRaw, raw.parametrizadorRaw], result);
    result.invocations = raw.parametrizadorRaw ? 2 : 1;
    result.selected_plugin = raw.selectedName;
    result.params = raw.params;
    result.abstained = raw.abstained;
    result.format_error = raw.formatError;
    return result;
  }

  if (isPEVResult(raw)) {
    accumulate(raw.messages, result);
    result.invocations = raw.messages.length;
    result.selected_plugin =
      raw.selectedTool === "NINGUNO_APLICA" ? null : raw.selectedTool;
    result.abstained = raw.selectedTool === "NINGUNO_APLICA";
    result.params = raw.args?.params ?? null;
    result.format_error = false;
    result.multiple_tool_calls = false;
    result.selection_attempts_final = raw.selectionAttempts;
    result.parametrizer_attempts_final = raw.parametrizerAttempts;
    return result;
  }

  accumulate([raw], result);
  result.invocations = 1;

  const validCalls = raw.tool_calls ?? [];
  const invalidCalls = raw.invalid_tool_calls ?? [];

  if (validCalls.length === 0) {
    if (invalidCalls.length > 0) {
      result.format_error = true;
    } else {
      result.abstained = true;
    }
    return result;
  }

  result.multiple_tool_calls = validCalls.length > 1;
  result.selected_plugin = validCalls[0].name;
  result.params = validCalls[0].args as Record<string, unknown>;

  return result;
}