const wordsOf = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * Whether what the microphone heard is just the speakers: most of its words are in lines that were being spoken a
 * moment ago. Lets the student talk over the group by voice without the group's own voices cutting it off.
 */
export function isEcho(heard: string, spoken: string[]): boolean {
  const words = wordsOf(heard);
  if (!words.length) return true;
  const known = new Set(spoken.flatMap(wordsOf));
  return words.filter((w) => known.has(w)).length / words.length >= 0.7;
}

export const wordCount = (text: string) => wordsOf(text).length;
