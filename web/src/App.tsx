import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { fetchConfig, getCode, streamReply, unlock, type Config, type Lesson } from "./lib/api";
import type { Engine, Message } from "./lib/types";
import { splitSentences } from "./lib/speech";
import { useRecognizer } from "./hooks/useRecognizer";
import { useSpeaker } from "./hooks/useSpeaker";
import { useVoiceConversation } from "./hooks/useVoiceConversation";
import { CHARACTERS, DEFAULT_CHARACTER } from "./avatar/characters";
import GroupChat from "./components/GroupChat";
import MessageTools from "./components/MessageTools";
import ConversationControls from "./components/ConversationControls";
import { exportConversation } from "./lib/exportConversation";
import { loadPref, savePref } from "./lib/prefs";

const LEVEL_NAMES: Record<string, string> = {
  A1: "A1 · Beginner",
  A2: "A2 · Elementary",
  B1: "B1 · Intermediate",
  B2: "B2 · Upper-intermediate",
  C1: "C1 · Advanced",
  C2: "C2 · Mastery",
  "C2+": "C2+ · Beyond mastery",
};

// three.js and the 3D model are only downloaded when the teacher is shown.
const VrmTeacher = lazy(() => import("./avatar/Avatar"));
const CartoonTeacher = lazy(() => import("./avatar/CartoonAvatar"));

const START_LESSON = "Hello! Please start our lesson.";

export default function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [language, setLanguage] = useState(() => loadPref("language", "English"));
  const [level, setLevel] = useState(() => loadPref("level", "A1"));
  const [engine, setEngine] = useState<Engine>(() => {
    const saved = loadPref("engine", "voice");
    return saved === "text" || saved === "group" ? saved : "voice";
  });
  const [speakReplies, setSpeakReplies] = useState(true);
  // Microphone switch: once on it stays on, re-listening automatically after every turn.
  const [micOn, setMicOn] = useState(false);
  const [characterId, setCharacterId] = useState(() => loadPref("character", DEFAULT_CHARACTER));
  // null until the user chooses; then the transcript is hidden in voice calls, where you mostly listen, and shown in text chat.
  const [transcriptPref, setTranscriptPref] = useState<"on" | "off" | null>(() => {
    const saved = loadPref("transcript", "");
    return saved === "on" || saved === "off" ? saved : null;
  });
  // What the characters call the student: kept as typed (draft) and applied when the field is left.
  const [studentName, setStudentName] = useState(() => loadPref("studentName", ""));
  const [nameDraft, setNameDraft] = useState(studentName);
  const [showTeacher, setShowTeacher] = useState(() => loadPref("showTeacher", "on") === "on");
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
  const logRef = useRef<HTMLDivElement>(null);

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
  const character = CHARACTERS.find((c) => c.id === characterId) ?? CHARACTERS[0];
  const lesson = useMemo<Lesson>(
    () => ({ sessionId, language, level, character: character.id, studentName: studentName || undefined }),
    [sessionId, language, level, character.id, studentName],
  );

  const speaker = useSpeaker(speechTag, character.speech);
  const voice = useVoiceConversation();
  const voiceMode = engine === "voice";
  const groupMode = engine === "group";
  const teacherState = {
    analyser: voiceMode ? voice.analyser : null,
    speaking: voiceMode ? voice.teacherSpeaking : speaker.speaking,
    attentive: voiceMode && voice.status === "live" && !voice.teacherSpeaking,
  };
  const recognizer = useRecognizer({
    lang: speechTag,
    shouldListen: () => micOn && !busy && !speaker.speaking,
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
    // Scroll the transcript box itself, not the page.
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
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

  /** Applies the typed name. The characters need to start over to use it, so this begins a new conversation. */
  function commitName() {
    const name = nameDraft.trim().slice(0, 30);
    setNameDraft(name);
    if (name === studentName) return;
    newConversation(() => {
      setStudentName(name);
      savePref("studentName", name);
    });
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

  /** Ends whatever is going on: the call, the reply being written, speech and the microphone. The transcript stays. */
  function stopConversation() {
    stopAll();
    voice.stop();
    setMicOn(false);
  }

  function exportTranscript() {
    exportConversation(
      `${voiceMode ? "Voice call" : "Text chat"} in ${language} (${level})`,
      shown.map((m) => ({ speaker: m.role === "user" ? (studentName || "You") : character.name, text: m.text, interrupted: m.interrupted })),
    );
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

  const toggleTranscript = () => {
    const next = showTranscript ? "off" : "on";
    setTranscriptPref(next);
    savePref("transcript", next);
  };
  const shown = voiceMode ? voice.messages : messages;
  const showTranscript = transcriptPref ? transcriptPref === "on" : !voiceMode;
  // Errors stay visible even when the transcript is hidden.
  const visible = showTranscript ? shown : shown.filter((m) => m.error);
  const languageNames = config?.languages.map((l) => l.name) ?? [];
  const defaultTranslation = language === "English" ? "Turkish" : "English";
  // In text chat the reply is still arriving; wait until it is complete before offering to translate it.
  const streamingId = busy ? messages[messages.length - 1]?.id : undefined;

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

      {showTeacher && !groupMode && (
        <Suspense fallback={<div className="avatar" />}>
          {character.kind === "vrm" ? (
            <VrmTeacher modelUrl={character.url} {...teacherState} />
          ) : (
            <CartoonTeacher look={character.look} {...teacherState} />
          )}
        </Suspense>
      )}
      {showTeacher && character.credit && <p className="credit">{character.credit}</p>}

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
          Your name
          <input
            value={nameDraft}
            maxLength={30}
            placeholder="So they can call you"
            autoComplete="given-name"
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </label>
        <label>
          Engine
          <select
            value={engine}
            onChange={(e) => newConversation(() => { setEngine(e.target.value as Engine); savePref("engine", e.target.value); })}
          >
            <option value="voice">Natural voice conversation</option>
            <option value="text">Text chat with browser voice</option>
            <option value="group">Group conversation (up to 4)</option>
          </select>
        </label>
        {!groupMode && (
          <label>
            Teacher
            <select
              value={character.id}
              disabled={!showTeacher}
              onChange={(e) => {
                // A different teacher means a different voice and personality, so start a fresh conversation.
                newConversation(() => {
                  setCharacterId(e.target.value);
                  savePref("character", e.target.value);
                });
              }}
            >
              {CHARACTERS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={showTeacher}
            onChange={(e) => {
              setShowTeacher(e.target.checked);
              savePref("showTeacher", e.target.checked ? "on" : "off");
            }}
          />
          {groupMode ? "Show 3D table" : "Show teacher"}
        </label>
        {engine === "text" && (
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

      {groupMode ? (
        <GroupChat
          config={config}
          language={language}
          level={level}
          speechTag={speechTag}
          studentName={studentName || undefined}
          showScene={showTeacher}
          transcript={{ show: showTranscript, toggle: toggleTranscript }}
        />
      ) : (
        <>
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

        <div className="toolbar">
          <ConversationControls
            canStop={busy || speaker.speaking || micOn || listening || voice.status !== "idle"}
            canExport={shown.some((m) => m.text.trim() && !m.error)}
            onStop={stopConversation}
            onExport={exportTranscript}
          />
          <button
            type="button"
            className="toggle"
            aria-pressed={showTranscript}
            onClick={toggleTranscript}
          >
            💬 {showTranscript ? "Hide transcript" : "Show transcript"}
            {!showTranscript && shown.length > 0 ? ` (${shown.length})` : ""}
          </button>
        </div>

        <div ref={logRef} className={`log${showTranscript ? "" : " collapsed"}`}>
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
          {visible.map((m) => (
            <div key={m.id} className={`entry ${m.role}`}>
              <div className={`msg ${m.role}${m.error ? " error" : ""}${m.open ? " open" : ""}`}>
                {m.text || "…"}
                {m.interrupted && <span className="cut"> —</span>}
              </div>
              {m.text && !m.error && !m.open && m.id !== streamingId && (
                <MessageTools text={m.text} role={m.role} languages={languageNames} defaultTarget={defaultTranslation}>
                  {!voiceMode && m.role === "assistant" && (
                    <>
                      <button type="button" className="chip" onClick={() => { speaker.stop(); speaker.speakText(m.text); }}>
                        🔊 Replay
                      </button>
                      {m.timing && <span className="timing">{m.timing}</span>}
                    </>
                  )}
                </MessageTools>
              )}
            </div>
          ))}
          {showTranscript && !voiceMode && interim && <div className="msg user interim">🎤 {interim}</div>}
          {!voiceMode && micOn && !interim && (
            <div className="mic-status">{listening ? "🎤 Listening…" : "Microphone on · paused while the teacher talks"}</div>
          )}
        </div>

        <div className="dock">
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
        </div>
        </>
      )}
    </main>
  );
}
