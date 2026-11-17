import { useEffect, useState } from "react";
import { CheckIcon, Loader2Icon, MicIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { useVoiceInput } from "../hooks/useVoiceInput.ts";
import { nextSpeechLanguage, SPEECH_LANGUAGES } from "../lib/language.ts";

type VoiceInput = ReturnType<typeof useVoiceInput>;

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function RecordingControls({ voice, startedAt }: { voice: VoiceInput; startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex items-center gap-1 rounded-md border border-destructive/40 px-1.5">
      <span className="size-2 animate-pulse rounded-full bg-destructive" />
      <span className="w-9 text-xs tabular-nums text-foreground" aria-live="polite">
        {formatElapsed(now - startedAt)}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title="Cancel recording"
        aria-label="Cancel recording"
        onClick={voice.cancelRecording}
      >
        <XIcon className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title="Stop and transcribe"
        aria-label="Stop and transcribe"
        onClick={voice.stopRecording}
      >
        <CheckIcon className="size-3.5" />
      </Button>
    </div>
  );
}

/** Mic button for the chat input; becomes the recording controls while recording. */
export function VoiceInputButton({
  voice,
  disabled,
}: {
  voice: VoiceInput;
  disabled?: boolean;
}) {
  const { state } = voice;

  if (state.kind === "recording") {
    return <RecordingControls voice={voice} startedAt={state.startedAt} />;
  }

  if (state.kind === "busy") {
    const label =
      state.phase?.kind === "loading"
        ? `Downloading the speech model (first time only)… ${Math.round(state.phase.progress)}%`
        : "Transcribing…";
    return (
      <div className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground" role="status">
        <Loader2Icon className="size-3.5 animate-spin" />
        <span>{label}</span>
      </div>
    );
  }

  const current = SPEECH_LANGUAGES.find((l) => l.code === voice.language)!;
  const next = SPEECH_LANGUAGES.find(
    (l) => l.code === nextSpeechLanguage(voice.language),
  )!;
  return (
    <div className="flex items-center">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="rounded-r-none"
        disabled={disabled}
        title="Record a voice message"
        aria-label="Record a voice message"
        onClick={() => void voice.startRecording()}
      >
        <MicIcon className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="-ml-px w-9 rounded-l-none text-[11px] font-medium"
        disabled={disabled}
        title={`Speaking ${current.label}. Switch to ${next.label}`}
        aria-label={`Transcription language: ${current.label}. Switch to ${next.label}`}
        onClick={() => voice.setLanguage(next.code)}
      >
        {current.short}
      </Button>
    </div>
  );
}
