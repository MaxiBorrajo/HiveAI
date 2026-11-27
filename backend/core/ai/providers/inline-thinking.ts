/**
 * Some local models think out loud inside `<think>…</think>` in the answer
 * itself. Ollama only lifts that out when thinking is requested; with it off,
 * a model that thinks anyway leaves the tags in the text. This moves them to
 * the reasoning, as if the model had reported them separately.
 */

const OPEN_TAGS = ["<think>", "<thinking>"];
const CLOSE_TAGS = ["</think>", "</thinking>"];

function findTag(text: string, tags: string[]): { index: number; length: number } | null {
  const lower = text.toLowerCase();
  let found: { index: number; length: number } | null = null;
  for (const tag of tags) {
    const index = lower.indexOf(tag);
    if (index !== -1 && (!found || index < found.index)) found = { index, length: tag.length };
  }
  return found;
}

/** Length of a tag's beginning at the very end of `text`, which the next chunk may complete. */
function partialTagAtEnd(text: string, tags: string[]): number {
  const lower = text.toLowerCase();
  const longest = Math.max(...tags.map((t) => t.length)) - 1;
  for (let length = Math.min(longest, lower.length); length > 0; length--) {
    const tail = lower.slice(-length);
    if (tags.some((tag) => tag.startsWith(tail))) return length;
  }
  return 0;
}

export interface SplitText {
  text: string;
  thinking: string;
}

/** Splits streamed text chunk by chunk; a tag cut between two chunks is still recognized. */
export class InlineThinkingSplitter {
  #inThinking = false;
  #pending = "";

  push(chunk: string): SplitText {
    let rest = this.#pending + chunk;
    this.#pending = "";
    const out: SplitText = { text: "", thinking: "" };

    while (rest) {
      if (!this.#inThinking) {
        const open = findTag(rest, OPEN_TAGS);
        if (open) {
          out.text += rest.slice(0, open.index);
          rest = rest.slice(open.index + open.length);
          this.#inThinking = true;
          continue;
        }
        // A closing tag with no opening one: the opening was in the prompt
        // template. What came before already went out as text; drop the tag.
        const strayClose = findTag(rest, CLOSE_TAGS);
        if (strayClose) {
          out.text += rest.slice(0, strayClose.index);
          rest = rest.slice(strayClose.index + strayClose.length);
          continue;
        }
        const held = partialTagAtEnd(rest, [...OPEN_TAGS, ...CLOSE_TAGS]);
        out.text += rest.slice(0, rest.length - held);
        this.#pending = rest.slice(rest.length - held);
        break;
      }

      const close = findTag(rest, CLOSE_TAGS);
      if (close) {
        out.thinking += rest.slice(0, close.index);
        rest = rest.slice(close.index + close.length);
        this.#inThinking = false;
        continue;
      }
      const held = partialTagAtEnd(rest, CLOSE_TAGS);
      out.thinking += rest.slice(0, rest.length - held);
      this.#pending = rest.slice(rest.length - held);
      break;
    }
    return out;
  }

  /** Whatever was held back waiting for the rest of a tag. */
  flush(): SplitText {
    const pending = this.#pending;
    this.#pending = "";
    return this.#inThinking ? { text: "", thinking: pending } : { text: pending, thinking: "" };
  }
}

/** The same split, for a whole text at once. */
export function splitInlineThinking(text: string): SplitText {
  const splitter = new InlineThinkingSplitter();
  const head = splitter.push(text);
  const tail = splitter.flush();
  return { text: head.text + tail.text, thinking: head.thinking + tail.thinking };
}
