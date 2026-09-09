import { ModelInfo } from "../../models/types.ts";
import { fetchModelInfo } from "../../models/useCases/getModelInfo/index.ts";
import { fetchAvailableModels } from "../../models/useCases/getModels/index.ts";
import { ChatMode } from "../types.ts";
import si from "npm:systeminformation";

const MLOCK_SAFETY_MARGIN = 1.2; // 20% de RAM libre por encima del tamaño del modelo
const BYTES_PER_MIB = 1024 * 1024;
const MIN_DRAFT_SIZE_RATIO = 3;

export async function findCompatibleDraftModels(
  targetModel: ModelInfo,
): Promise<ModelInfo[]> {
  const candidates = await fetchAvailableModels({
    family: targetModel.family,
    maxParameterCount: targetModel.parameterCount / MIN_DRAFT_SIZE_RATIO,
    minContextLength: targetModel.contextLength,
    excludeName: targetModel.name,
  });

  return candidates;
}

async function getVRAM(): Promise<number | null> {
  try {
    const cmd = new Deno.Command("nvidia-smi", {
      args: ["--query-gpu=memory.free", "--format=csv,noheader,nounits"],
    });
    const { stdout, success } = await cmd.output();
    if (!success) return null;

    const lines = new TextDecoder().decode(stdout).trim().split("\n");
    const total = lines.reduce((sum, line) => sum + parseInt(line.trim()), 0);
    return total * BYTES_PER_MIB;
  } catch {
    return null;
  }
}

// Runtime-calculated hints for parameters whose valid range/options/default
// depend on the currently loaded model and host machine, and therefore can't
// live as static values in modes.config.json.
export async function calculateRuntimeHints(activeModel: string) {
  const modelInfo = await fetchModelInfo(activeModel);
  if (!modelInfo) return null;

  const cpu = await si.cpu();
  const mem = await si.mem();

  const vramFree = await getVRAM();
  const maxGpuLayers = vramFree
    ? Math.min(
        Math.floor(vramFree / modelInfo.bytesPerLayer),
        modelInfo.layerCount,
      )
    : 0;

  const mlockSafe = mem.available > modelInfo.sizeBytes * MLOCK_SAFETY_MARGIN;

  const candidates = await findCompatibleDraftModels(modelInfo);

  return {
    maxGpuLayers,
    physicalCores: cpu.physicalCores,
    mlockSafe,
    compatibleDraftModels: candidates.map((c) => c.name),
  };
}

export type RuntimeHints = Exclude<
  Awaited<ReturnType<typeof calculateRuntimeHints>>,
  null
>;

function applyRuntimeHints(mode: ChatMode, hints: RuntimeHints) {
  if (mode.name === "default") return;

  for (const parameter of mode.parameters ?? []) {
    if (parameter.name === "spec_deco") {
      parameter.options = hints.compatibleDraftModels;
      if (!hints.compatibleDraftModels.includes(parameter.currentValue as string)) {
        parameter.currentValue = "";
      }
    }

    if (parameter.name === "n_gpu_layers") {
      parameter.maxValue = hints.maxGpuLayers;
    }

    if (parameter.name === "n_threads") {
      parameter.maxValue = hints.physicalCores;
      parameter.defaultValue = hints.physicalCores;
      parameter.currentValue = hints.physicalCores;
    }

    if (parameter.name === "mlock") {
      parameter.defaultValue = hints.mlockSafe;
      parameter.currentValue = hints.mlockSafe;
    }
  }
}

export async function calculateRuntimeModes(
  modes: ChatMode[],
  activeModel: string,
  currentMode: string,
): Promise<ChatMode[]> {
  const modesCopy = structuredClone(modes) as ChatMode[];
  for (const mode of modesCopy) {
    mode.isCurrent = mode.name === currentMode;
  }

  const hints = await calculateRuntimeHints(activeModel);
  if (!hints) return modesCopy;

  for (const mode of modesCopy) {
    applyRuntimeHints(mode, hints);
  }

  return modesCopy;
}
