/// <reference lib="webworker" />
import { pipeline, type ProgressInfo } from "@huggingface/transformers";
import type { TranscribeEvent, TranscribeRequest } from "./protocol.ts";

/**
 * Multilingual; "base" got too many Spanish words wrong, "small" is the step
 * up that still runs on a laptop.
 */
const MODEL = "onnx-community/whisper-small";

/**
 * The encoder (the part that listens) loses much of its accuracy when
 * quantized, so it stays full precision; the decoder takes 4-bit well.
 */
const DTYPE = { encoder_model: "fp32", decoder_model_merged: "q4" } as const;

type Transcriber = Awaited<ReturnType<typeof loadTranscriber>>;

function loadTranscriber(
  device: "webgpu" | "wasm",
  onProgress: (percent: number) => void,
) {
  return pipeline("automatic-speech-recognition", MODEL, {
    device,
    dtype: DTYPE,
    progress_callback: (info: ProgressInfo) => {
      if (info.status === "progress_total") onProgress(info.progress);
    },
  });
}

/** The GPU when the system offers it; any failure there falls back to the CPU. */
async function loadOnBestDevice(onProgress: (percent: number) => void) {
  if ("gpu" in navigator) {
    try {
      return await loadTranscriber("webgpu", onProgress);
    } catch (error) {
      console.warn("[voice] WebGPU unavailable, transcribing on the CPU:", error);
    }
  }
  return await loadTranscriber("wasm", onProgress);
}

let transcriber: Promise<Transcriber> | null = null;

function post(event: TranscribeEvent) {
  self.postMessage(event);
}

self.onmessage = async (event: MessageEvent<TranscribeRequest>) => {
  const { id, audio, language } = event.data;
  try {
    // Downloaded once, then the browser cache serves it.
    transcriber ??= loadOnBestDevice((progress) =>
      post({ id, type: "loading", progress })
    );
    const asr = await transcriber;
    post({ id, type: "transcribing" });
    // Chunking lets recordings run past Whisper's 30-second window.
    const output = await asr(audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
      task: "transcribe",
      language,
    });
    const text = (Array.isArray(output) ? output[0] : output).text;
    post({ id, type: "result", text: text.trim() });
  } catch (error) {
    // A failed load must not stick: the next try downloads again.
    transcriber = null;
    post({
      id,
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
