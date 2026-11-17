/** The languages the user can pick for transcription; add one here to offer it. */
export const SPEECH_LANGUAGES = [
  { code: "es", short: "ES", label: "Español" },
  { code: "en", short: "EN", label: "English" },
] as const;

export type SpeechLanguage = (typeof SPEECH_LANGUAGES)[number]["code"];

const STORAGE_KEY = "hiveai.voice.language";

function isSpeechLanguage(code: string | null | undefined): code is SpeechLanguage {
  return SPEECH_LANGUAGES.some((l) => l.code === code);
}

/**
 * Whisper itself can tell languages apart, but transformers.js does not
 * implement that and falls back to English, which turns Spanish speech into
 * an English translation. So the language is always chosen: the user's last
 * pick, else the system language when it is offered, else the first one.
 */
export function defaultSpeechLanguage(
  languages: readonly string[] = navigator.languages ?? [navigator.language],
): SpeechLanguage {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isSpeechLanguage(saved)) return saved;
  } catch {
    // Storage can be blocked; the system language still works.
  }
  for (const tag of languages) {
    const code = tag?.split("-")[0]?.toLowerCase();
    if (isSpeechLanguage(code)) return code;
  }
  return SPEECH_LANGUAGES[0].code;
}

export function saveSpeechLanguage(code: SpeechLanguage): void {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Not remembered this time; nothing else depends on it.
  }
}

export function nextSpeechLanguage(code: SpeechLanguage): SpeechLanguage {
  const index = SPEECH_LANGUAGES.findIndex((l) => l.code === code);
  return SPEECH_LANGUAGES[(index + 1) % SPEECH_LANGUAGES.length].code;
}
