/**
 * What each teacher character sounds like. The ids match web/src/avatar/characters.ts.
 * `voice` is one of Gemini's prebuilt voices, used in voice calls; `persona` shapes how the teacher
 * talks, in both voice calls and text chat.
 *
 * Google does not say which voices are male or female, so these are picked from its style
 * descriptions (Informative, Warm, Excitable, Clear, Breezy, ...) and are easy to change here.
 */
export const CHARACTER_VOICES: Record<string, { voice: string; persona: string }> = {
  professor: {
    voice: "Sadaltager", // Knowledgeable
    persona:
      "You are Professor Whiskers, a warm, wise and slightly old-fashioned professor with a gentle sense of humour. Speak calmly and unhurriedly, in a deep, kind voice.",
  },
  luna: {
    voice: "Sulafat", // Warm
    persona:
      "You are Ms. Luna, a gentle, encouraging and patient young teacher. Speak softly and warmly, and celebrate the student's small wins.",
  },
  rex: {
    voice: "Fenrir", // Excitable
    persona:
      "You are Coach Rex, an energetic, motivating coach-style teacher. Speak with lots of energy in short, punchy phrases, and cheer the student on.",
  },
  robot: {
    voice: "Iapetus", // Clear
    persona:
      "You are Robo-Tutor, a cheerful and precise friendly robot. Speak in a clear, even, slightly mechanical tone, and enjoy the occasional light robot joke.",
  },
  anime: {
    voice: "Aoede", // Breezy
    persona: "You are a bright, cheerful and kind young teacher. Speak lightly and enthusiastically, with a smile in your voice.",
  },
};

export const DEFAULT_CHARACTER = "professor";

/** The Gemini voice for a character, or GEMINI_VOICE / the model's default when it has none. */
export function voiceFor(character: string): string | undefined {
  return CHARACTER_VOICES[character]?.voice ?? process.env.GEMINI_VOICE;
}
