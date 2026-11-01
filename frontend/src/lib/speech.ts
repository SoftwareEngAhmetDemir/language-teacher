import i18n from "../i18n";
import { languageInline } from "../i18n/labels";

/** What to tell the student when speech recognition fails with this error code; undefined for errors that need no message. */
export function recognitionProblem(code: string, language: string): string | undefined {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return i18n.t("mic.blocked");
    case "audio-capture":
      return i18n.t("mic.missing");
    case "network":
      return i18n.t("mic.network");
    case "language-not-supported":
      return i18n.t("mic.languageUnsupported", { language: languageInline(i18n.t, language) });
  }
}

const SENTENCE_END = /[.!?…]+["')\]]*(?=\s)|[。！？]+|\n+/;

/**
 * Splits streamed text into complete sentences plus the unfinished remainder, so
 * each sentence can be spoken as soon as it is complete instead of after the whole reply.
 */
export function splitSentences(text: string): { ready: string[]; rest: string } {
  const ready: string[] = [];
  let rest = text;
  for (;;) {
    const match = SENTENCE_END.exec(rest);
    if (!match) break;
    const end = match.index + match[0].length;
    const sentence = rest.slice(0, end).trim();
    if (sentence) ready.push(sentence);
    rest = rest.slice(end);
  }
  return { ready, rest };
}

/** Drops markdown-ish symbols the voice would otherwise read out. */
export function cleanForSpeech(text: string): string {
  return text.replace(/[*_#`>~]/g, "").trim();
}

const normalize = (lang: string) => lang.toLowerCase().replace("_", "-");

/**
 * Voices that can speak the given BCP-47 tag (tr-TR), best first: exact locale before
 * other locales of the same language (tr), on-device voices before network ones, and
 * higher-quality "Premium/Enhanced/Natural" voices ahead of the basic ones.
 */
const HIGH_QUALITY = /premium|enhanced|neural|natural|siri|wavenet|google/i;

export function voicesForLanguage(tag: string, voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const wanted = normalize(tag);
  const base = wanted.split("-")[0];
  const score = (v: SpeechSynthesisVoice) => {
    const lang = normalize(v.lang);
    if (lang !== wanted && lang.split("-")[0] !== base) return -1;
    return (lang === wanted ? 2 : 0) + (v.localService ? 1 : 0) + (HIGH_QUALITY.test(v.name) ? 4 : 0);
  };
  return voices
    .filter((v) => score(v) >= 0)
    .sort((a, b) => score(b) - score(a));
}
