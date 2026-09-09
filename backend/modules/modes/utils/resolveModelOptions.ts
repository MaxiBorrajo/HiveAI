import { readModesConfig } from "./modesConfig.ts";
import { ChatModeParameter } from "../types.ts";

export interface OllamaModelOptions {
  [key: string]: unknown;
  numCtx?: number;
  numGpu?: number;
  numThread?: number;
  numBatch?: number;
  useMmap?: boolean;
  useMlock?: boolean;
  temperature?: number;
  topK?: number;
  topP?: number;
  repeatPenalty?: number;
  numPredict?: number;
}

function resolveNumPredict(parameters: ChatModeParameter[]): number | undefined {
  const limitOutput = parameters.find((p) => p.name === "limit_output");
  if (limitOutput?.currentValue === false) return -1;
  return undefined;
}

function toNumber(value: ChatModeParameter["currentValue"]): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function toBoolean(value: ChatModeParameter["currentValue"]): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function mapModeToOllamaOptions(
  parameters: ChatModeParameter[],
): OllamaModelOptions {
  const byName = new Map(parameters.map((p) => [p.name, p.currentValue]));

  const options: OllamaModelOptions = {
    numCtx: toNumber(byName.get("n_ctx")),
    numGpu: toNumber(byName.get("n_gpu_layers")),
    numThread: toNumber(byName.get("n_threads")),
    numBatch: toNumber(byName.get("n_batch")),
    useMmap: toBoolean(byName.get("mmap")),
    useMlock: toBoolean(byName.get("mlock")),
    temperature: toNumber(byName.get("temperature")),
    topK: toNumber(byName.get("top_k")),
    topP: toNumber(byName.get("top_p")),
    repeatPenalty: toNumber(byName.get("repeat_penalty")),
    numPredict: resolveNumPredict(parameters),
  };
  
  for (const key of Object.keys(options)) {
    if (options[key] === undefined) delete options[key];
  }

  return options;
}

export async function resolveModelOptions(
  currentMode: string,
): Promise<OllamaModelOptions> {
  const modes = await readModesConfig();
  const mode = modes.find((m) => m.name === currentMode);
  if (!mode?.parameters) return {};

  return mapModeToOllamaOptions(mode.parameters);
}
