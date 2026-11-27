import { decodeAudio } from "./decodeAudio.ts";
import type { SpeechLanguage } from "./language.ts";
import type { TranscribeEvent, TranscribeRequest } from "./protocol.ts";

export type TranscriptionPhase =
  /** First use only: the speech model is being downloaded, 0-100. */
  | { kind: "loading"; progress: number }
  | { kind: "transcribing" };

interface Pending {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  onPhase?: (phase: TranscriptionPhase) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

/** One worker for the whole app, so the model is loaded only once. */
function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./transcriber.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (event: MessageEvent<TranscribeEvent>) => {
    const message = event.data;
    const job = pending.get(message.id);
    if (!job) return;
    if (message.type === "loading") {
      job.onPhase?.({ kind: "loading", progress: message.progress });
    } else if (message.type === "transcribing") {
      job.onPhase?.({ kind: "transcribing" });
    } else {
      pending.delete(message.id);
      if (message.type === "result") job.resolve(message.text);
      else job.reject(new Error(message.message));
    }
  };
  return worker;
}

/** Transcribes any audio the browser can play, entirely on this computer. */
export async function transcribeAudio(
  blob: Blob,
  language: SpeechLanguage,
  onPhase?: (phase: TranscriptionPhase) => void,
): Promise<string> {
  const audio = await decodeAudio(blob);
  const id = nextId++;
  return await new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject, onPhase });
    const request: TranscribeRequest = { id, audio, language };
    getWorker().postMessage(request, [audio.buffer]);
  });
}
