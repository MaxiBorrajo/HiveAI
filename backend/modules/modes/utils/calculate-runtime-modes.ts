import { fetchModelInfo } from "../../models/useCases/getModelInfo/index.ts";
import { ChatMode } from "../types.ts";
import si from "npm:systeminformation";

const MLOCK_SAFETY_MARGIN = 1.2;
const BYTES_PER_MIB = 1024 * 1024;
const COMFORTABLE_FIT_MARGIN = 1.5;

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

export async function calculateRuntimeHints(activeModel: string) {
  const modelInfo = await fetchModelInfo(activeModel);
  if (!modelInfo) return null;

  const cpu = await si.cpu();
  const mem = await si.mem();

  const vramFree = await getVRAM();
  const vramCapacityInLayers = vramFree
    ? Math.floor(vramFree / modelInfo.bytesPerLayer)
    : 0;
  const maxGpuLayers = Math.min(vramCapacityInLayers, modelInfo.layerCount);

  const mlockSafe = mem.available > modelInfo.sizeBytes * MLOCK_SAFETY_MARGIN;

  const modelFitsComfortably =
    vramFree !== null &&
    vramCapacityInLayers >= modelInfo.layerCount * COMFORTABLE_FIT_MARGIN;

  return {
    maxGpuLayers,
    physicalCores: cpu.physicalCores,
    mlockSafe,
    modelFitsComfortably,
  };
}

export type RuntimeHints = Exclude<
  Awaited<ReturnType<typeof calculateRuntimeHints>>,
  null
>;

function applyRuntimeHints(mode: ChatMode, hints: RuntimeHints) {
  if (mode.name === "default") return;

  if (mode.name === "light" && hints.modelFitsComfortably) {
    mode.performanceNote =
      "This model already fits comfortably in your available VRAM, so Light's smaller context window mainly trades away context length, not speed — generation speed is usually about the same as Full. Use Light only if you want to save memory or expect short conversations.";
  }

  for (const parameter of mode.parameters ?? []) {
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

    if (parameter.name === "mmap") {
      parameter.defaultValue = !hints.mlockSafe;
      parameter.currentValue = !hints.mlockSafe;
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
