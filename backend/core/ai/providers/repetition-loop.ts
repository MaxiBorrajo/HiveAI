/**
 * Small local models sometimes fall into a loop, repeating the same word or
 * sentence until the context fills up. Nothing on the model side stops it for
 * sure (repeat_penalty only makes it rarer), so the output is watched instead.
 */

/** Longest repeated unit looked for: a long sentence. */
const MAX_PERIOD = 300;
/** A loop must repeat its unit this many times... */
const MIN_REPEATS = 8;
/** ...and fill at least this much, so tables, rulers and short lists pass. */
const MIN_SPAN = 400;

/**
 * If `text` ends in a loop, where to cut it so one copy of the repeated part
 * is kept; null when it does not.
 */
export function findRepetitionLoop(text: string): number | null {
  const end = text.length;
  for (let period = 1; period <= MAX_PERIOD; period++) {
    const needed = Math.max(MIN_SPAN, period * MIN_REPEATS);
    if (end < needed) break;
    // How far back the text keeps matching itself one period earlier.
    let run = 0;
    while (run < needed - period && text[end - 1 - run] === text[end - 1 - run - period]) run++;
    if (run >= needed - period) {
      // Extend to where the loop really started, then keep a single copy.
      while (end - 1 - run - period >= 0 && text[end - 1 - run] === text[end - 1 - run - period]) run++;
      return end - run;
    }
  }
  return null;
}

/** Checks a growing text every few hundred characters, not on every token. */
export class RepetitionWatcher {
  #checkedAt = 0;

  constructor(private readonly every = 200) {}

  /** The cut point once `text` has fallen into a loop, otherwise null. */
  check(text: string): number | null {
    if (text.length - this.#checkedAt < this.every) return null;
    this.#checkedAt = text.length;
    return findRepetitionLoop(text);
  }
}

export const REPETITION_LOOP_WARNING =
  "The model got stuck repeating the same text, so its answer was cut there. Trying again, or with another model, usually fixes it.";
