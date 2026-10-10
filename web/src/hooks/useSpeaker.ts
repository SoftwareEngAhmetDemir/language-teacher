import { useCallback, useEffect, useRef, useState } from "react";
import { cleanForSpeech, splitSentences, voicesForLanguage } from "../lib/speech";

const DEFAULT_RATE = 1.1;

const supported = typeof window !== "undefined" && "speechSynthesis" in window;

function loadPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Resolves once the browser has loaded its voice list (it is empty until then), or after a short wait. */
function voicesLoaded(): Promise<void> {
  return new Promise((resolve) => {
    if (speechSynthesis.getVoices().length) return resolve();
    const done = () => {
      speechSynthesis.removeEventListener("voiceschanged", done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 1500);
    speechSynthesis.addEventListener("voiceschanged", done);
  });
}

/** Text-to-speech through the browser's speechSynthesis, in the given BCP-47 language. */
export function useSpeaker(tag: string, style: { pitch: number; rate: number } = { pitch: 1, rate: 1 }) {
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [allLoaded, setAllLoaded] = useState(false);
  const [chosenURI, setChosenURI] = useState<string | null>(() => loadPref(`voice:${tag}`));
  const [rate, setRateState] = useState(() => Number(loadPref("rate")) || DEFAULT_RATE);
  const rateRef = useRef(rate);
  rateRef.current = rate;
  // The character's own pitch and pace, kept in a ref so sentences queued earlier keep using the latest.
  const styleRef = useRef(style);
  styleRef.current = style;
  const pending = useRef(0);
  // Bumped on stop() so late events from cancelled utterances are ignored.
  const generation = useRef(0);

  const refresh = useCallback(() => {
    if (!supported) return [];
    const all = speechSynthesis.getVoices();
    setAllLoaded(all.length > 0);
    const forLanguage = voicesForLanguage(tag, all);
    setVoices(forLanguage);
    return forLanguage;
  }, [tag]);

  useEffect(() => {
    if (!supported) return;
    setChosenURI(loadPref(`voice:${tag}`));
    refresh();
    speechSynthesis.addEventListener("voiceschanged", refresh);
    return () => speechSynthesis.removeEventListener("voiceschanged", refresh);
  }, [tag, refresh]);

  const voice = voices.find((v) => v.voiceURI === chosenURI) ?? voices[0];
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const chooseVoice = useCallback(
    (uri: string) => {
      setChosenURI(uri);
      try {
        localStorage.setItem(`voice:${tag}`, uri);
      } catch {
        // The choice just won't be remembered.
      }
    },
    [tag],
  );

  const setRate = useCallback((value: number) => {
    setRateState(value);
    try {
      localStorage.setItem("rate", String(value));
    } catch {
      // The choice just won't be remembered.
    }
  }, []);

  const speak = useCallback(
    (text: string) => {
      const clean = cleanForSpeech(text);
      if (!clean || !supported) return;

      const gen = generation.current;
      pending.current++;
      setSpeaking(true);
      const finish = () => {
        if (gen !== generation.current) return;
        pending.current = Math.max(0, pending.current - 1);
        if (pending.current === 0) setSpeaking(false);
      };

      const run = () => {
        if (gen !== generation.current) return;
        // Look the voice up now: the list may only just have loaded.
        const fresh = refresh();
        const chosen = fresh.find((v) => v.voiceURI === chosenURI) ?? voiceRef.current ?? fresh[0];
        const utterance = new SpeechSynthesisUtterance(clean);
        // Without an explicit voice for this language the browser may fall back to its default
        // (usually English) voice and mispronounce letters like ş, so always set one when we can.
        utterance.lang = chosen?.lang ?? tag;
        if (chosen) utterance.voice = chosen;
        utterance.rate = Math.min(2, Math.max(0.5, rateRef.current * styleRef.current.rate));
        utterance.pitch = Math.min(2, Math.max(0, styleRef.current.pitch));
        utterance.onend = finish;
        utterance.onerror = finish;
        speechSynthesis.speak(utterance);
      };

      if (speechSynthesis.getVoices().length) run();
      else void voicesLoaded().then(run);
    },
    [tag, chosenURI, refresh],
  );

  /** Speaks a finished text sentence by sentence (long single utterances get cut off in Chrome). */
  const speakText = useCallback(
    (text: string) => {
      const { ready, rest } = splitSentences(text);
      [...ready, rest].forEach(speak);
    },
    [speak],
  );

  const stop = useCallback(() => {
    generation.current++;
    pending.current = 0;
    if (supported) speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  useEffect(() => stop, [stop]);

  return {
    speak,
    speakText,
    stop,
    speaking,
    voices,
    voice,
    chooseVoice,
    rate,
    setRate,
    /** False only when the browser has loaded its voices and none speak this language. */
    hasVoice: !allLoaded || voices.length > 0,
  };
}
