import { useCallback, useEffect, useRef, useState } from "react";

interface Options {
  /** BCP-47 language tag, e.g. "tr-TR". */
  lang: string;
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  /** SpeechRecognition error code, e.g. "not-allowed" or "network". */
  onError: (code: string) => void;
  /** The session ended, so any phrase it was in the middle of is over. */
  onEnd?: () => void;
  /**
   * Whether the microphone should be open right now. When the browser ends a session by itself (after a stretch of
   * silence, say) a new one starts in the same moment, so words spoken right after are not lost to a restart gap.
   */
  shouldListen?: () => boolean;
  /**
   * The microphone to listen to, such as one with echo cancellation. Without one, or in a browser that can't take one,
   * recognition opens the default microphone itself.
   */
  audioTrack?: () => MediaStreamTrack | null | undefined;
}

/**
 * A phrase whose words haven't changed for this long is taken as finished. The browser normally finishes a phrase
 * within a second of silence, but sometimes never does (with noise or voices in the room, or after a network hiccup),
 * and then nothing the student says is heard until the page is reloaded.
 */
const STALLED_PHRASE_MS = 2500;

/** A session that has reported nothing at all for this long has usually stopped listening without saying so. */
const SILENT_SESSION_MS = 30_000;

/**
 * How long to wait for the browser to confirm that a session has ended before giving up on it. A stopped session may
 * still be finishing the last words it heard, so it gets longer than one that was dropped.
 */
const END_GRACE_MS = { stop: 5000, abort: 1500 };

/** A session that ends this soon after starting is restarted after a pause, so a failing microphone is not retried in a tight loop. */
const QUICK_END_MS = 1000;
const RETRY_DELAY_MS = 500;

/** How long the microphone may listen without hearing a single sound before the student is told to check it. */
const NO_SOUND_HINT_MS = 8000;

const Recognition =
  typeof window === "undefined" ? undefined : (window.SpeechRecognition ?? window.webkitSpeechRecognition);

/**
 * Speech-to-text through the browser's SpeechRecognition, reopened straight away whenever the browser closes it.
 *
 * The browser's recognition can stop working without telling: a phrase is never finished, a session goes quiet for
 * good, or it never reports that it has ended. Each of these is watched for, and the session is replaced, so the
 * microphone never stays deaf.
 */
export function useRecognizer(options: Options) {
  const [listening, setListening] = useState(false);
  // The session running now and how to end it; null when none is.
  const session = useRef<{ end: (how: "stop" | "abort") => void } | null>(null);
  const latest = useRef(options);
  const restart = useRef<() => void>(() => {});
  const retryTimer = useRef(0);
  // Once the component has gone, a session that ends is not reopened.
  const unmounted = useRef(false);
  // Whether the microphone has ever delivered a sound, and whether it has now been listening a while without one.
  const soundSeen = useRef(false);
  const [silent, setSilent] = useState(false);
  useEffect(() => {
    latest.current = options;
  });

  // A microphone that hears nothing at all (the wrong one is selected, or it is muted) looks just like one waiting for
  // the student to talk. Until it has heard something, say so after a while, so the student knows to check it.
  useEffect(() => {
    if (!listening || soundSeen.current) return;
    const timer = window.setTimeout(() => setSilent(!soundSeen.current), NO_SOUND_HINT_MS);
    return () => window.clearTimeout(timer);
  }, [listening]);

  const start = useCallback(() => {
    if (!Recognition || session.current || unmounted.current) return;
    window.clearTimeout(retryTimer.current);
    const r = new Recognition();
    r.lang = latest.current.lang;
    r.interimResults = true;
    // Keeps listening through pauses; the browser still ends a session after a long silence, and it is reopened.
    r.continuous = true;
    r.maxAlternatives = 1;

    const startedAt = Date.now();
    let lastEvent = startedAt;
    // The unfinished phrase as last reported, and since when it has read like that.
    let phrase = "";
    let phraseSince = 0;
    let graceTimer = 0;
    let over = false;

    /** The session is over, whichever way: forget it, and open a new one if the microphone should stay on. */
    const finished = () => {
      if (over) return;
      over = true;
      window.clearInterval(watchdog);
      window.clearTimeout(graceTimer);
      // Anything the browser still reports for this session is too late to use.
      r.onresult = r.onerror = r.onend = r.onaudiostart = r.onsoundstart = r.onspeechstart = r.onspeechend = null;
      if (session.current === controls) session.current = null;
      setListening(false);
      latest.current.onEnd?.();
      const reopen = () => {
        if (!unmounted.current && latest.current.shouldListen?.()) restart.current();
      };
      if (Date.now() - startedAt < QUICK_END_MS) retryTimer.current = window.setTimeout(reopen, RETRY_DELAY_MS);
      else reopen();
    };

    /** Ends the session: `stop` lets the browser finish what it heard first, `abort` drops it. */
    const end = (how: "stop" | "abort") => {
      if (over) return;
      try {
        if (how === "stop") r.stop();
        else r.abort();
      } catch {
        // Not running; the grace timer below still closes it.
      }
      // Don't rely on the browser saying it has ended: sometimes it never does.
      window.clearTimeout(graceTimer);
      graceTimer = window.setTimeout(finished, END_GRACE_MS[how]);
    };
    const controls = { end };

    const watchdog = window.setInterval(() => {
      const now = Date.now();
      if (phrase && now - phraseSince > STALLED_PHRASE_MS) {
        // The browser has stopped working on this phrase without finishing it: finish it here and start afresh.
        const text = phrase.trim();
        phrase = "";
        r.onresult = null; // so a late result for the same words can't be sent a second time
        if (text) latest.current.onFinal(text);
        end("abort");
      } else if (now - lastEvent > SILENT_SESSION_MS) {
        end("abort");
      }
    }, 500);

    const alive = () => {
      lastEvent = Date.now();
    };
    const heard = () => {
      alive();
      if (soundSeen.current) return;
      soundSeen.current = true;
      setSilent(false);
    };
    r.onaudiostart = r.onspeechend = alive;
    r.onsoundstart = r.onspeechstart = heard;
    r.onresult = (event) => {
      heard();
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) final += result[0].transcript;
        else interim += result[0].transcript;
      }
      // A finished phrase comes before the next one that has already begun.
      if (final.trim()) latest.current.onFinal(final.trim());
      if (interim !== phrase) {
        phrase = interim;
        phraseSince = Date.now();
      }
      if (interim) latest.current.onInterim(interim);
    };
    r.onerror = (event) => {
      alive();
      latest.current.onError(event.error);
    };
    r.onend = finished;

    session.current = controls;
    setListening(true);
    const track = latest.current.audioTrack?.();
    try {
      // A browser that can't take a track ignores it and opens the default microphone.
      if (track?.readyState === "live") r.start(track);
      else r.start();
    } catch {
      // One that refuses the track still gets to listen with its own microphone.
      try {
        if (track) r.start();
        else finished();
      } catch {
        finished();
      }
    }
  }, []);

  useEffect(() => {
    restart.current = start;
  }, [start]);

  const stop = useCallback(() => {
    window.clearTimeout(retryTimer.current);
    session.current?.end("stop");
  }, []);

  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      window.clearTimeout(retryTimer.current);
      session.current?.end("abort");
    };
  }, []);

  return {
    supported: !!Recognition,
    listening,
    /** Listening, but the microphone hasn't delivered any sound since the page opened. */
    silent: listening && silent,
    start,
    stop,
  };
}
