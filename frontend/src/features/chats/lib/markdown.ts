const VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "m4v", "ogv"];
const AUDIO_EXTENSIONS = ["mp3", "wav", "m4a", "ogg", "oga", "opus", "flac", "aac"];

/** What a link or image points to, judged by the file extension of its URL. */
export function mediaKind(url: string | undefined): "video" | "audio" | null {
  if (!url) return null;
  const path = url.split(/[?#]/)[0].toLowerCase();
  const extension = path.slice(path.lastIndexOf(".") + 1);
  if (VIDEO_EXTENSIONS.includes(extension)) return "video";
  if (AUDIO_EXTENSIONS.includes(extension)) return "audio";
  return null;
}

/** Code (fenced or inline) is left alone; only the text around it is rewritten. */
const CODE = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/;

/**
 * Many models write math as \( … \) and \[ … \]; the renderer reads $$ … $$.
 * A single $ is not math here, so prices like "$5 and $10" stay as text.
 */
export function normalizeMathDelimiters(text: string): string {
  if (!text.includes("\\(") && !text.includes("\\[")) return text;
  return text
    .split(CODE)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part
          .replace(/\\\[([\s\S]+?)\\\]/g, (_, math: string) => `\n$$\n${math.trim()}\n$$\n`)
          .replace(/\\\((.+?)\\\)/g, (_, math: string) => `$$${math.trim()}$$`)
    )
    .join("");
}

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * Where the last code block starts when it is still open (the answer is
 * arriving and its closing fence has not come yet); null when all are closed.
 */
export function openFenceOffset(text: string): number | null {
  let open: { char: string; length: number; offset: number } | null = null;
  let offset = 0;
  for (const line of text.split("\n")) {
    const match = FENCE.exec(line);
    if (match) {
      const [, fence, rest] = match;
      if (!open) {
        open = { char: fence[0], length: fence.length, offset };
      } else if (fence[0] === open.char && fence.length >= open.length && !rest.trim()) {
        open = null;
      }
    }
    offset += line.length + 1;
  }
  return open?.offset ?? null;
}
