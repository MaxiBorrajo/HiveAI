/** Messages between the app and the speech worker, matched by `id`. */
export interface TranscribeRequest {
  id: number;
  audio: Float32Array;
  /** Two-letter code; without one the model would assume English. */
  language: string;
}

export type TranscribeEvent =
  /** The model is being downloaded (first use only), 0-100. */
  | { id: number; type: "loading"; progress: number }
  | { id: number; type: "transcribing" }
  | { id: number; type: "result"; text: string }
  | { id: number; type: "error"; message: string };
