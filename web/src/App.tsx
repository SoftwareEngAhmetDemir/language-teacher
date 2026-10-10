import { useEffect, useMemo, useRef, useState } from "react";
import { fetchConfig, getCode, streamReply, unlock, type Config, type Lesson } from "./lib/api";
import type { Engine, Message } from "./lib/types";
import { splitSentences } from "./lib/speech";
import { useRecognizer } from "./hooks/useRecognizer";
import { useSpeaker } from "./hooks/useSpeaker";
import { useVoiceConversation } from "./hooks/useVoiceConversation";

const LEVEL_NAMES: Record<string, string> = {
  A1: "A1 · Beginner",
  A2: "A2 · Elementary",
  B1: "B1 · Intermediate",
  B2: "B2 · Upper-intermediate",
  C1: "C1 · Advanced",
  C2: "C2 · Mastery",
  "C2+": "C2+ · Beyond mastery",
};

const START_LESSON = "Hello! Please start our lesson.";

function loadPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function savePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preferences are a convenience only.
  }
}

export default function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [language, setLanguage] = useState(() => loadPref("language", "English"));
  const [level, setLevel] = useState(() => loadPref("level", "A1"));
  const [engine, setEngine] = useState<Engine>(() => (loadPref("engine", "voice") === "text" ? "text" : "voice"));
  const [speakReplies, setSpeakReplies] = useState(true);
  // Microphone switch: once on it stays on, re-listening automatically after every turn.
  const [micOn, setMicOn] = useState(false);
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const [unlocked, setUnlocked] = useState(() => getCode() !== "");
  const [codeInput, setCodeInput] = useState("");
  const [codeWrong, setCodeWrong] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [interim, setInterim] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchConfig()
      .then((c) => {
        setConfig(c);
        setLanguage((l) => (c.languages.some((x) => x.name === l) ? l : c.languages[0].name));
        setLevel((l) => (c.levels.includes(l) ? l : c.levels[0]));
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  const speechTag = config?.languages.find((l) => l.name === language)?.speechTag ?? "en-US";
  const lesson = useMemo<Lesson>(
    () => ({ sessionId, language, level }),
    [sessionId, language, level],
  );

  const speaker = useSpeaker(speechTag);
  const voice = useVoiceConversation();
  const voiceMode = engine === "voice";
  const recognizer = useRecognizer({
    lang: speechTag,
    onInterim: setInterim,
    onFinal: (text) => {
      setInterim("");
      void send(text);
    },
    onError: (code) => {
      const problem: Record<string, string> = {
        "not-allowed": "Microphone access was blocked. Allow it in your browser's site settings.",
        "service-not-allowed": "Microphone access was blocked. Allow it in your browser's site settings.",
        "audio-capture": "No microphone was found.",
        network: "Speech recognition needs an internet connection.",
        "language-not-supported": `This browser cannot recognise ${language} speech.`,
      };
      if (problem[code]) {
        setNotice(problem[code]);
        setMicOn(false);
      }
    },
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, voice.messages, interim]);

  // While the mic is on, keep listening, pausing only while the teacher is talking so it doesn't hear itself.
  const { listening, start: startListening } = recognizer;
  useEffect(() => {
    if (!micOn || !recognizer.supported || busy || speaker.speaking || listening) return;
    const timer = setTimeout(startListening, 200);
    return () => clearTimeout(timer);
  }, [micOn, recognizer.supported, busy, speaker.speaking, listening, startListening]);

  function stopAll() {
    abortRef.current?.abort();
    speaker.stop();
    recognizer.stop();
    setInterim("");
  }

  function newConversation(change: () => void) {
    stopAll();
    voice.stop();
    voice.clear();
    setMicOn(false);
    setMessages([]);
    setSessionId(crypto.randomUUID());
    change();
  }

  async function send(text: string, hidden = false) {
    const trimmed = text.trim();
    if (!trimmed || abortRef.current) return;
    speaker.stop();
    recognizer.stop();
    setInterim("");
    setNotice(null);

    const assistantId = nextId.current++;
    const added: Message[] = [];
    if (!hidden) added.push({ id: nextId.current++, role: "user", text: trimmed });
    added.push({ id: assistantId, role: "assistant", text: "" });
    setMessages((m) => [...m, ...added]);

    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    const patch = (p: Partial<Message>) =>
      setMessages((m) => m.map((x) => (x.id === assistantId ? { ...x, ...p } : x)));

    const started = performance.now();
    let firstWord: number | undefined;
    let full = "";
    let unspoken = "";
    try {
      for await (const delta of streamReply(lesson, trimmed, controller.signal)) {
        firstWord ??= performance.now() - started;
        full += delta;
        patch({ text: full });
        if (speakReplies) {
          // Speak each sentence as soon as it is complete rather than after the whole reply.
          const { ready, rest } = splitSentences(unspoken + delta);
          unspoken = rest;
          ready.forEach(speaker.speak);
        }
      }
      if (speakReplies && unspoken.trim()) speaker.speak(unspoken);
      patch({
        text: full || "(no reply)",
        error: !full,
        timing: `first word ${Math.round(firstWord ?? 0)} ms · total ${Math.round(performance.now() - started)} ms`,
      });
    } catch (e) {
      if (controller.signal.aborted) {
        if (!full) setMessages((m) => m.filter((x) => x.id !== assistantId));
      } else {
        patch({ text: full ? `${full}\n\n${(e as Error).message}` : (e as Error).message, error: true });
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  function toggleMic() {
    if (micOn) {
      setMicOn(false);
      recognizer.stop();
      return;
    }
    setMicOn(true);
    setNotice(null);
    // Start straight from the click (browsers want a user gesture); afterwards the effect above takes over.
    if (!busy && !speaker.speaking) startListening();
  }

  const shown = voiceMode ? voice.messages : messages;

  if (loadError) {
    return (
      <main>
        <p className="notice error">
          Could not reach the service: {loadError}. Start it with <code>npm run dev</code> in the project root.
        </p>
      </main>
    );
  }
  if (!config) return <main>Loading…</main>;

  if (config.requiresCode && !unlocked) {
    return (
      <main>
        <h1>Language Teacher</h1>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await unlock(codeInput);
            setUnlocked(ok);
            setCodeWrong(!ok);
          }}
        >
          <input
            type="password"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            placeholder="Access code"
            autoFocus
          />
          <button type="submit" disabled={!codeInput}>
            Enter
          </button>
        </form>
        {codeWrong && <p className="notice error">Wrong access code.</p>}
      </main>
    );
  }

  return (
    <main>
      <header>
        <h1>Language Teacher</h1>
      </header>

      <section className="settings">
        <label>
          Language
          <select value={language} onChange={(e) => newConversation(() => { setLanguage(e.target.value); savePref("language", e.target.value); })}>
            {config.languages.map((l) => (
              <option key={l.name}>{l.name}</option>
            ))}
          </select>
        </label>
        <label>
          Level
          <select value={level} onChange={(e) => newConversation(() => { setLevel(e.target.value); savePref("level", e.target.value); })}>
            {config.levels.map((l) => (
              <option key={l} value={l}>
                {LEVEL_NAMES[l] ?? l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Engine
          <select
            value={engine}
            onChange={(e) => newConversation(() => { setEngine(e.target.value as Engine); savePref("engine", e.target.value); })}
          >
            <option value="voice">Natural voice conversation</option>
            <option value="text">Text chat with browser voice</option>
          </select>
        </label>
        {!voiceMode && (
          <>
            <label>
              Voice
              <select
                value={speaker.voice?.voiceURI ?? ""}
                disabled={speaker.voices.length === 0}
                onChange={(e) => speaker.chooseVoice(e.target.value)}
              >
                {speaker.voices.length === 0 && <option value="">No {language} voice</option>}
                {speaker.voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Speed {speaker.rate.toFixed(2)}×
              <input
                type="range"
                min="0.7"
                max="1.6"
                step="0.05"
                value={speaker.rate}
                onChange={(e) => speaker.setRate(Number(e.target.value))}
              />
            </label>
            <label className="check">
              <input type="checkbox" checked={speakReplies} onChange={(e) => { setSpeakReplies(e.target.checked); if (!e.target.checked) speaker.stop(); }} />
              Speak replies
            </label>
          </>
        )}
      </section>

      {!voiceMode && !recognizer.supported && (
        <p className="notice">Voice input isn't supported in this browser. Use Chrome, Edge or Safari, or type instead.</p>
      )}
      {!voiceMode && speakReplies && !speaker.hasVoice && (
        <p className="notice">
          This browser has no {language} voice, so replies would be read with the wrong pronunciation. Install one in your system's speech settings (on macOS: System Settings → Accessibility → Spoken Content → System Voice → Manage Voices), then reload.
        </p>
      )}
      {notice && !voiceMode && <p className="notice error">{notice}</p>}
      {voiceMode && voice.error && <p className="notice error">{voice.error}</p>}

      <div className="log">
        {shown.length === 0 && (
          <div className="empty">
            {voiceMode ? (
              <p>
                Practise {language} at level {level} in a real conversation. Start the call, allow the microphone and just talk. You can interrupt the teacher at any moment. Headphones work best.
              </p>
            ) : (
              <>
                <p>
                  Practise {language} at level {level}. Press the microphone and speak, type below, or let the teacher begin.
                </p>
                <button onClick={() => send(START_LESSON, true)} disabled={busy}>
                  Start lesson
                </button>
              </>
            )}
          </div>
        )}
        {shown.map((m) => (
          <div key={m.id} className={`msg ${m.role}${m.error ? " error" : ""}${m.open ? " open" : ""}`}>
            {m.text || "…"}
            {m.interrupted && <span className="cut"> —</span>}
            {!voiceMode && m.role === "assistant" && m.text && !m.error && (
              <div className="meta">
                <button className="link" onClick={() => { speaker.stop(); speaker.speakText(m.text); }}>
                  🔊 Replay
                </button>
                {m.timing && <span>{m.timing}</span>}
              </div>
            )}
          </div>
        ))}
        {!voiceMode && interim && <div className="msg user interim">🎤 {interim}</div>}
        {!voiceMode && micOn && !interim && (
          <div className="mic-status">{listening ? "🎤 Listening…" : "Microphone on · paused while the teacher talks"}</div>
        )}
        <div ref={endRef} />
      </div>

      {voiceMode && (
        <div className="call">
          <button
            className={`call-btn${voice.status === "idle" ? "" : " end"}${voice.teacherSpeaking ? " talking" : ""}`}
            disabled={voice.status === "connecting"}
            onClick={() => (voice.status === "idle" ? void voice.start(lesson) : voice.stop())}
          >
            {voice.status === "idle" ? "🎤 Start conversation" : voice.status === "connecting" ? "Connecting…" : "End conversation"}
          </button>
          {voice.status === "live" && (
            <button onClick={voice.toggleMute}>{voice.muted ? "Unmute" : "Mute"}</button>
          )}
          <span className="call-status">
            {voice.status === "live" &&
              (voice.muted ? "Muted" : voice.teacherSpeaking ? "Teacher is speaking · talk any time to interrupt" : "Listening…")}
          </span>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (voiceMode) voice.sendText(input);
          else void send(input);
          setInput("");
        }}
      >
        {!voiceMode && (
          <button type="button" className={`mic${micOn ? " on" : ""}${listening ? " live" : ""}`} onClick={toggleMic} disabled={!recognizer.supported} aria-label={micOn ? "Turn microphone off" : "Turn microphone on"} title={micOn ? "Microphone on. Click to turn off" : "Click to turn the microphone on"}>
            🎤
          </button>
        )}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={voiceMode && voice.status !== "live" ? "Start the conversation to type as well" : `Type in ${language}…`}
          disabled={voiceMode && voice.status !== "live"}
          autoComplete="off"
        />
        {!voiceMode && (busy || speaker.speaking) ? (
          <button type="button" onClick={stopAll}>
            Stop
          </button>
        ) : (
          <button type="submit" disabled={!input.trim() || (voiceMode && voice.status !== "live")}>
            Send
          </button>
        )}
      </form>
    </main>
  );
}
