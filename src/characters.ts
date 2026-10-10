/**
 * Everything the server knows about each teacher character. The ids match web/src/avatar/characters.ts.
 *
 * - `voice`: one of Gemini's prebuilt voices, used in voice calls and for group-chat speech.
 *   Google does not say which voices are male or female, so these are matched to its style
 *   descriptions and are easy to change here.
 * - `ttsStyle`: how the voice should deliver lines in group chat.
 * - `persona`: how the character talks, in every mode. It only changes tone, never the language or level.
 * - `groupRole` and `name`: who they are in a group conversation.
 * - `model`: optional text model for this character in group chat. Characters can run on different
 *   models; unset uses the default text model (GEMINI_TEXT_MODEL).
 */
export interface CharacterProfile {
  name: string;
  voice: string;
  ttsStyle: string;
  persona: string;
  groupRole: string;
  model?: string;
}

export const CHARACTER_PROFILES: Record<string, CharacterProfile> = {
  professor: {
    name: "Professor Whiskers",
    voice: "Sadaltager", // Knowledgeable
    ttsStyle: "calm, warm and unhurried, like a kind professor",
    persona:
      "You are Professor Whiskers, a warm, wise and slightly old-fashioned professor with a gentle sense of humour. Speak calmly and unhurriedly, in a deep, kind voice.",
    groupRole:
      "the group's teacher: you gently guide the topic, and when the student makes a mistake you naturally say the correct form",
  },
  luna: {
    name: "Luna",
    voice: "Sulafat", // Warm
    ttsStyle: "gentle, warm and encouraging",
    persona:
      "You are Ms. Luna, a gentle, encouraging and patient young teacher. Speak softly and warmly, and celebrate the student's small wins.",
    groupRole: "a kind, curious classmate who encourages the student and asks thoughtful questions",
  },
  rex: {
    name: "Rex",
    voice: "Fenrir", // Excitable
    ttsStyle: "energetic, upbeat and enthusiastic, like a sports coach",
    persona:
      "You are Coach Rex, an energetic, motivating coach-style teacher. Speak with lots of energy in short, punchy phrases, and cheer the student on.",
    groupRole: "an upbeat, joking classmate who loves sports and friendly challenges",
  },
  robot: {
    name: "Robo",
    voice: "Iapetus", // Clear
    ttsStyle: "clear, even and slightly robotic, but friendly",
    persona:
      "You are Robo-Tutor, a cheerful and precise friendly robot. Speak in a clear, even, slightly mechanical tone, and enjoy the occasional light robot joke.",
    groupRole: "a precise, quirky classmate who loves facts and numbers and makes the odd robot joke",
  },
  anime: {
    name: "Hana",
    voice: "Aoede", // Breezy
    ttsStyle: "bright, light and cheerful",
    persona: "You are a bright, cheerful and kind young teacher. Speak lightly and enthusiastically, with a smile in your voice.",
    groupRole: "a cheerful, enthusiastic classmate who shares little stories and asks lots of questions",
  },
};

export const DEFAULT_CHARACTER = "professor";

export const isCharacterId = (value: unknown): value is string =>
  typeof value === "string" && Object.hasOwn(CHARACTER_PROFILES, value);

/** The Gemini voice for a character, or GEMINI_VOICE / the model's default when it has none. */
export function voiceFor(character: string): string | undefined {
  return CHARACTER_PROFILES[character]?.voice ?? process.env.GEMINI_VOICE;
}
