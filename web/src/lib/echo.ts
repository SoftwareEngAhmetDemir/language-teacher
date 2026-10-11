const wordsOf = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** Whether two words differ by at most one letter added, removed or changed (speech recognition often gets one letter wrong). */
function near(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i);
}

/**
 * Whether what the microphone heard is just the speakers: most of its words are in lines that were being spoken a
 * moment ago (allowing for a letter or two misheard). Lets the student talk over the group by voice without the
 * group's own voices being taken for the student.
 */
export function isEcho(heard: string, spoken: string[]): boolean {
  const words = wordsOf(heard);
  if (!words.length) return true;
  const known = [...new Set(spoken.flatMap(wordsOf))];
  const matched = words.filter((w) => known.some((k) => near(w, k))).length;
  return matched / words.length >= (words.length >= 3 ? 0.6 : 1);
}

export const wordCount = (text: string) => wordsOf(text).length;
