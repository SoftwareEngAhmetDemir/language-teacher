import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { fetchConfig, getCode, streamReply, unlock, type Config, type Lesson } from "./lib/api";
import type { Engine, Message } from "./lib/types";
import { recognitionProblem, splitSentences } from "./lib/speech";
import { useRecognizer } from "./hooks/useRecognizer";
import { useSpeaker } from "./hooks/useSpeaker";
import { useVoiceConversation } from "./hooks/useVoiceConversation";
import { CHARACTERS, DEFAULT_CHARACTER } from "./avatar/characters";
import GroupChat from "./components/GroupChat";
import MessageTools from "./components/MessageTools";
import ConversationControls from "./components/ConversationControls";
import { exportConversation } from "./lib/exportConversation";
import { loadPref, savePref } from "./lib/prefs";
import LanguageSwitcher from "./i18n/LanguageSwitcher";
import { languageInline, languageLabel, levelLabel } from "./i18n/labels";

// three.js and the 3D model are only downloaded when the teacher is shown.
const VrmTeacher = lazy(() => import("./avatar/Avatar"));
const CartoonTeacher = lazy(() => import("./avatar/CartoonAvatar"));

const START_LESSON = "Hello! Please start our lesson.";

export default function App() {
  const { t } = useTranslation();
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
  // The group scene is being prepared: the settings wait until it is ready.
  const [sceneBusy, setSceneBusy] = useState(false);

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
      const problem = recognitionProblem(code, language);
      if (problem) {
        setNotice(problem);
        setMicOn(false);
      }
    },
  });

  useEffect(() => {
    // Scroll the transcript box itself, not the page.
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, voice.messages, interim]);

  // While the mic is on, keep listening, pausing only while the teacher is talking so it doesn't hear itself.
  const { listening, start: startListening, stop: stopListening } = recognizer;
  useEffect(() => {
    // Left open while the teacher speaks, the mic would hear the replies and answer for the student.
    if (busy || speaker.speaking) stopListening();
  }, [busy, speaker.speaking, stopListening]);
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
        text: full || t("chat.noReply"),
        error: !full,
        timing: t("chat.timing", { first: Math.round(firstWord ?? 0), total: Math.round(performance.now() - started) }),
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
      t(voiceMode ? "exportTitle.voice" : "exportTitle.text", { language: languageInline(t, language), level }),
      shown.map((m) => ({ speaker: m.role === "user" ? (studentName || t("chat.you")) : character.name, text: m.text, interrupted: m.interrupted })),
      `${voiceMode ? "voice-call" : "text-chat"}-${language}-${level}`,
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
          <Trans i18nKey="loadError" values={{ message: loadError }} components={{ code: <code /> }} />
        </p>
      </main>
    );
  }
  if (!config) return <main>{t("app.loading")}</main>;

  if (config.requiresCode && !unlocked) {
    return (
      <main>
        <header>
          <h1>{t("app.title")}</h1>
          <LanguageSwitcher />
        </header>
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
            placeholder={t("access.placeholder")}
            autoFocus
          />
          <button type="submit" disabled={!codeInput}>
            {t("access.enter")}
          </button>
        </form>
        {codeWrong && <p className="notice error">{t("access.wrong")}</p>}
      </main>
    );
  }

  return (
    <main>
      <header>
        <h1>{t("app.title")}</h1>
        <LanguageSwitcher />
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

      <fieldset className="settings" disabled={sceneBusy}>
        <label>
          {t("settings.language")}
          <select value={language} onChange={(e) => newConversation(() => { setLanguage(e.target.value); savePref("language", e.target.value); })}>
            {config.languages.map((l) => (
              <option key={l.name} value={l.name}>
                {languageLabel(t, l.name)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("settings.level")}
          <select value={level} onChange={(e) => newConversation(() => { setLevel(e.target.value); savePref("level", e.target.value); })}>
            {config.levels.map((l) => (
              <option key={l} value={l}>
                {levelLabel(t, l)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("settings.yourName")}
          <input
            value={nameDraft}
            maxLength={30}
            placeholder={t("settings.namePlaceholder")}
            autoComplete="given-name"
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </label>
        <label>
          {t("settings.engine")}
          <select
            value={engine}
            onChange={(e) => newConversation(() => { setEngine(e.target.value as Engine); savePref("engine", e.target.value); })}
          >
            <option value="voice">{t("engines.voice")}</option>
            <option value="text">{t("engines.text")}</option>
            <option value="group">{t("engines.group", { max: config.group.max })}</option>
          </select>
        </label>
        {!groupMode && (
          <label>
            {t("settings.teacher")}
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
          {groupMode ? t("settings.showTable") : t("settings.showTeacher")}
        </label>
        {engine === "text" && (
          <>
            <label>
              {t("settings.voice")}
              <select
                value={speaker.voice?.voiceURI ?? ""}
                disabled={speaker.voices.length === 0}
                onChange={(e) => speaker.chooseVoice(e.target.value)}
              >
                {speaker.voices.length === 0 && <option value="">{t("settings.noVoice", { language: languageInline(t, language) })}</option>}
                {speaker.voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("settings.speed", { rate: speaker.rate.toFixed(2) })}
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
              {t("settings.speakReplies")}
            </label>
          </>
        )}
      </fieldset>

      {groupMode ? (
        <GroupChat
          config={config}
          language={language}
          level={level}
          speechTag={speechTag}
          studentName={studentName || undefined}
          showScene={showTeacher}
          transcript={{ show: showTranscript, toggle: toggleTranscript }}
          onBusyChange={setSceneBusy}
        />
      ) : (
        <>
        {!voiceMode && !recognizer.supported && (
          <p className="notice">{t("notices.voiceInputUnsupported")}</p>
        )}
        {!voiceMode && speakReplies && !speaker.hasVoice && (
          <p className="notice">
            {t("notices.noBrowserVoice", { language: languageInline(t, language) })}
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
            💬 {showTranscript ? t("toolbar.hideTranscript") : t("toolbar.showTranscript")}
            {!showTranscript && shown.length > 0 ? ` (${shown.length})` : ""}
          </button>
        </div>

        <div ref={logRef} className={`log${showTranscript ? "" : " collapsed"}`}>
          {shown.length === 0 && (
            <div className="empty">
              {voiceMode ? (
                <p>
                  {t("chat.emptyVoice", { language: languageInline(t, language), level })}
                </p>
              ) : (
                <>
                  <p>
                    {t("chat.emptyText", { language: languageInline(t, language), level })}
                  </p>
                  <button onClick={() => send(START_LESSON, true)} disabled={busy}>
                    {t("chat.startLesson")}
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
                        🔊 {t("chat.replay")}
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
            <div className="mic-status">{listening ? `🎤 ${t("mic.listening")}` : t("mic.pausedWhileTeacherTalks")}</div>
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
                {voice.status === "idle" ? `🎤 ${t("call.start")}` : voice.status === "connecting" ? t("call.connecting") : t("call.end")}
              </button>
              {voice.status === "live" && (
                <button onClick={voice.toggleMute}>{voice.muted ? t("call.unmute") : t("call.mute")}</button>
              )}
              <span className="call-status">
                {voice.status === "live" &&
                  (voice.muted ? t("call.muted") : voice.teacherSpeaking ? t("call.teacherSpeaking") : t("call.listening"))}
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
              <button type="button" className={`mic${micOn ? " on" : ""}${listening ? " live" : ""}`} onClick={toggleMic} disabled={!recognizer.supported} aria-label={micOn ? t("mic.turnOff") : t("mic.turnOn")} title={micOn ? t("mic.titleOn") : t("mic.titleOff")}>
                🎤
              </button>
            )}
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={voiceMode && voice.status !== "live" ? t("chat.typeToo") : t("chat.typeIn", { language: languageInline(t, language) })}
              disabled={voiceMode && voice.status !== "live"}
              autoComplete="off"
            />
            {!voiceMode && (busy || speaker.speaking) ? (
              <button type="button" onClick={stopAll}>
                {t("chat.stop")}
              </button>
            ) : (
              <button type="submit" disabled={!input.trim() || (voiceMode && voice.status !== "live")}>
                {t("chat.send")}
              </button>
            )}
          </form>
        </div>
        </>
      )}
    </main>
  );
}
