interface Word {
  /** As it was written or heard. */
  text: string;
  /**
   * The form words are compared in: lower case, without accents, and with the Turkish dotless ı written as i, since
   * speech recognition spells these inconsistently.
   */
  key: string;
}

const keyOf = (word: string) => word.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i");

const wordsOf = (text: string): Word[] =>
  (text.match(/[\p{L}\p{N}\p{M}]+/gu) ?? []).map((text) => ({ text, key: keyOf(text) })).filter((w) => w.key);

/** Whether two strings differ by at most `max` letters added, removed or changed. */
function within(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length] <= max;
}

/**
 * Whether a heard word is a spoken one, allowing for how recognition gets words wrong: a word still being recognised
 * (only its start so far), another ending of the same word (common in languages like Turkish), and a letter or two
 * misheard in a longer word.
 */
function near(heard: string, spoken: string): boolean {
  if (heard === spoken) return true;
  if (Math.min(heard.length, spoken.length) >= 3 && (spoken.startsWith(heard) || heard.startsWith(spoken))) return true;
  if (heard.length < 4 || spoken.length < 4) return false;
  return within(heard, spoken, heard.length >= 8 && spoken.length >= 8 ? 2 : 1);
}

/** Marks the heard words that follow a spoken line word for word for two words or more: the line coming back. */
function echoRuns(heard: string[], lines: string[][]): boolean[] {
  const marked = heard.map(() => false);
  for (const line of lines) {
    for (let i = 0; i < heard.length; i++) {
      for (let k = 0; k < line.length; k++) {
        let length = 0;
        while (i + length < heard.length && k + length < line.length && near(heard[i + length], line[k + length])) length++;
        if (length >= 2) marked.fill(true, i, i + length);
      }
    }
  }
  return marked;
}

/**
 * The student's own words in what the microphone heard while the group's voices could be heard too, with the echo of
 * those voices taken out; empty when it was all echo. `spoken` is what the group was saying at the time.
 *
 * Echo shows in two ways: runs of words at the start or end of the phrase that follow a line word for word, and phrases
 * made mostly of the lines' words when recognition has garbled them. What is left once the runs are taken out only
 * counts as the student's when it has words of their own: a stray word or two left over from the echo is not something
 * the student said.
 */
export function withoutEcho(heard: string, spoken: string[]): string {
  const words = wordsOf(heard);
  const lines = spoken.map((line) => wordsOf(line).map((w) => w.key));
  const known = [...new Set(lines.flat())];
  const marked = echoRuns(words.map((w) => w.key), lines);
  // Echo comes before or after what the student says, so only runs at either end are cut. The same words in the middle
  // are the student's own: answers often repeat the question's words.
  let from = 0;
  let to = words.length;
  while (from < to && marked[from]) from++;
  while (to > from && marked[to - 1]) to--;
  const rest = words.slice(from, to);
  const novel = rest.filter((w) => !known.some((k) => near(w.key, k))).length;

  if (!rest.length) return "";
  // Mostly the lines' words: three in five for a longer phrase, every word for a short one.
  if ((rest.length - novel) / rest.length >= (rest.length >= 3 ? 0.6 : 1)) return "";
  if (rest.length < words.length && novel < 2) return "";
  return rest.length === words.length ? heard.trim() : rest.map((w) => w.text).join(" ");
}

/** A line the group said out loud. */
export interface HeardLine {
  text: string;
  /** When it stopped being heard (Date.now() time); unset while it is still being spoken. */
  end?: number;
}

/**
 * How long after the group's voices were heard what the microphone picked up of them may still begin to arrive:
 * recognition runs a moment behind the sound.
 */
export const ECHO_LAG_MS = 2000;

/**
 * How far back the lines in a phrase heard while the group talks can go. While they talk without a real pause the
 * browser can fall well behind and deliver a line several lines later.
 */
export const ECHO_MEMORY_MS = 20_000;

/**
 * The student's own words in a phrase the microphone heard, and how many of them the group was not saying.
 *
 * Echo is judged by when the phrase began to arrive (`start`), not by when it was finished: the browser only finishes
 * a phrase after a pause, which is often after the group has gone quiet. Only a phrase that began while the group could
 * be heard (`lastHeardAt`), or just after, can hold their voices; a phrase that began later is all the student's.
 */
export function studentWords(text: string, start: number, lastHeardAt: number, lines: HeardLine[]): { own: string; novel: number } {
  const spoken =
    lastHeardAt >= start - ECHO_LAG_MS ? lines.filter((l) => l.end === undefined || l.end >= start - ECHO_MEMORY_MS).map((l) => l.text) : [];
  const own = withoutEcho(text, spoken);
  return { own, novel: novelWordCount(own, spoken) };
}

/**
 * How many of the heard words are not in what was being spoken. Garbled echo has few of them, while a student who
 * really talks over the group brings words of their own, so this is what decides whether to cut the group off.
 */
export function novelWordCount(heard: string, spoken: string[]): number {
  const known = [...new Set(spoken.flatMap((line) => wordsOf(line).map((w) => w.key)))];
  return wordsOf(heard).filter((w) => !known.some((k) => near(w.key, k))).length;
}
