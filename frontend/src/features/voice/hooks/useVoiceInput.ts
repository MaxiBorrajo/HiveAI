import { useEffect, useRef, useState } from "react";
import { reportError } from "@/lib/toastManager";
import {
  transcribeAudio,
  type TranscriptionPhase,
} from "../lib/transcriber.ts";
import {
  defaultSpeechLanguage,
  saveSpeechLanguage,
  type SpeechLanguage,
} from "../lib/language.ts";

export type VoiceInputState =
  | { kind: "idle" }
  | { kind: "recording"; startedAt: number }
  | { kind: "busy"; phase: TranscriptionPhase | null };

function microphoneProblem(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access was denied. Allow it to record a voice message.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No microphone was found.";
  }
  if (name === "NotReadableError") {
    return "The microphone is being used by another app.";
  }
  return "Could not start recording.";
}

/**
 * Records from the microphone, or takes an audio file, and turns it into text
 * with a speech model that runs on this computer. The text goes to `onText`
 * so it can be reviewed before sending.
 */
export function useVoiceInput(onText: (text: string) => void) {
  const [state, setState] = useState<VoiceInputState>({ kind: "idle" });
  const [language, setLanguageState] = useState<SpeechLanguage>(() =>
    defaultSpeechLanguage()
  );
  // Read when the recording is transcribed, which may be after a switch.
  const languageRef = useRef(language);

  function setLanguage(code: SpeechLanguage) {
    setLanguageState(code);
    saveSpeechLanguage(code);
  }
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const discardRef = useRef(false);
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
    languageRef.current = language;
  });

  function releaseMicrophone() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }

  // Leaving the screen mid-recording must not leave the microphone on.
  useEffect(() => releaseMicrophone, []);

  async function transcribe(audio: Blob, what: string) {
    setState({ kind: "busy", phase: null });
    try {
      const text = await transcribeAudio(audio, languageRef.current, (phase) =>
        setState({ kind: "busy", phase })
      );
      if (text) onTextRef.current(text);
      else reportError([`No speech was recognized in the ${what}.`]);
    } catch (error) {
      reportError([
        `Could not transcribe the ${what}: ${error instanceof Error ? error.message : String(error)}`,
      ]);
    } finally {
      setState({ kind: "idle" });
    }
  }

  async function startRecording() {
    if (state.kind !== "idle") return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      reportError([microphoneProblem(error)]);
      return;
    }
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      releaseMicrophone();
      if (discardRef.current) {
        setState({ kind: "idle" });
        return;
      }
      void transcribe(new Blob(chunks, { type: recorder.mimeType }), "recording");
    };
    streamRef.current = stream;
    recorderRef.current = recorder;
    discardRef.current = false;
    recorder.start();
    setState({ kind: "recording", startedAt: Date.now() });
  }

  function stopRecording() {
    recorderRef.current?.stop();
  }

  function cancelRecording() {
    discardRef.current = true;
    recorderRef.current?.stop();
  }

  function transcribeFile(file: File) {
    if (state.kind !== "idle") return;
    void transcribe(file, `file '${file.name}'`);
  }

  return {
    state,
    language,
    setLanguage,
    startRecording,
    stopRecording,
    cancelRecording,
    transcribeFile,
  };
}
