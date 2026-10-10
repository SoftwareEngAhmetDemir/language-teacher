import { useCallback, useEffect, useRef, useState } from "react";

interface Options {
  /** BCP-47 language tag, e.g. "tr-TR". */
  lang: string;
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  /** SpeechRecognition error code, e.g. "not-allowed" or "network". */
  onError: (code: string) => void;
}

const Recognition =
  typeof window === "undefined" ? undefined : (window.SpeechRecognition ?? window.webkitSpeechRecognition);

/** Speech-to-text through the browser's SpeechRecognition: one utterance per start(). */
export function useRecognizer(options: Options) {
  const [listening, setListening] = useState(false);
  const recognition = useRef<SpeechRecognition | null>(null);
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  const start = useCallback(() => {
    if (!Recognition || recognition.current) return;
    const r = new Recognition();
    r.lang = latest.current.lang;
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    r.onresult = (event) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) final += result[0].transcript;
        else interim += result[0].transcript;
      }
      if (interim) latest.current.onInterim(interim);
      if (final.trim()) latest.current.onFinal(final.trim());
    };
    r.onerror = (event) => latest.current.onError(event.error);
    r.onend = () => {
      recognition.current = null;
      setListening(false);
    };
    recognition.current = r;
    setListening(true);
    try {
      r.start();
    } catch {
      recognition.current = null;
      setListening(false);
    }
  }, []);

  const stop = useCallback(() => recognition.current?.stop(), []);

  useEffect(() => () => recognition.current?.abort(), []);

  return { supported: !!Recognition, listening, start, stop };
}
