/** Formats the app's browser engine can decode, so they can be transcribed. */
export const AUDIO_EXTENSIONS = [
  ".mp3",
  ".wav",
  ".m4a",
  ".ogg",
  ".opus",
  ".webm",
  ".flac",
  ".aac",
];

export function isAudioFile(file: File): boolean {
  if (file.type.startsWith("audio/")) return true;
  const dot = file.name.lastIndexOf(".");
  return dot !== -1 && AUDIO_EXTENSIONS.includes(file.name.slice(dot).toLowerCase());
}
