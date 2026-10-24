import { readModelSettings } from "./settings-store.ts";
import { ModelSetting, ModelSettingValue } from "../types.ts";

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
  keepAlive?: string;
  think?: boolean;
}

export const LIMITED_OUTPUT_NUM_PREDICT = 2048;

function toNumber(value: ModelSettingValue | undefined): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function toBoolean(value: ModelSettingValue | undefined): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function toKeepAlive(value: ModelSettingValue | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function mapSettingsToOllamaOptions(
  settings: Pick<ModelSetting, "name" | "currentValue">[],
): OllamaModelOptions {
  const byName = new Map(settings.map((s) => [s.name, s.currentValue]));
  const numGpu = toNumber(byName.get("n_gpu_layers"));

  const options: OllamaModelOptions = {
    numCtx: toNumber(byName.get("n_ctx")),
    numGpu: numGpu === -1 ? undefined : numGpu,
    numThread: toNumber(byName.get("n_threads")),
    numBatch: toNumber(byName.get("n_batch")),
    useMmap: toBoolean(byName.get("mmap")),
    useMlock: toBoolean(byName.get("mlock")),
    temperature: toNumber(byName.get("temperature")),
    topK: toNumber(byName.get("top_k")),
    topP: toNumber(byName.get("top_p")),
    repeatPenalty: toNumber(byName.get("repeat_penalty")),
    numPredict:
      byName.get("limit_output") === true ? LIMITED_OUTPUT_NUM_PREDICT : -1,
    keepAlive: toKeepAlive(byName.get("keep_alive")),
    think: toBoolean(byName.get("thinking")),
  };

  for (const key of Object.keys(options)) {
    if (options[key] === undefined) delete options[key];
  }

  return options;
}

export async function resolveModelOptions(): Promise<OllamaModelOptions> {
  return mapSettingsToOllamaOptions(await readModelSettings());
}
