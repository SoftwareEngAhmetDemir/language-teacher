import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CHARACTERS } from "../avatar/characters";
import type { Seat } from "../avatar/GroupScene";
import MessageTools from "./MessageTools";
import ConversationControls from "./ConversationControls";
import { exportConversation } from "../lib/exportConversation";
import { useGroupChat } from "../hooks/useGroupChat";
import { useRecognizer } from "../hooks/useRecognizer";
import { presetStyle, styleFromServer, type SceneStyle } from "../avatar/sceneStyle";
import { fetchBackdrop, fetchSceneStyle, type Config } from "../lib/api";
import { studentWords } from "../lib/echo";
import { loadPref, savePref } from "../lib/prefs";
import { recognitionProblem } from "../lib/speech";
import { characterRole, languageInline, sceneTitle } from "../i18n/labels";

// three.js and the characters are only downloaded when a group scene is shown.
const GroupScene = lazy(() => import("../avatar/GroupScene"));

interface Props {
  config: Config;
  language: string;
  level: string;
  /** BCP-47 tag of the language being practised, for speech recognition and the browser voice fallback. */
  speechTag: string;
  /** What the characters call the student. */
  studentName?: string;
  showScene: boolean;
  transcript: { show: boolean; toggle: () => void };
  /** Called with true while the room is being prepared, so the rest of the page can wait too. */
  onBusyChange?: (busy: boolean) => void;
}

/** The longest the room is waited for before the group starts in the standard one. */
const PREPARE_TIMEOUT_MS = 35_000;

/** How long the student has to be quiet before what they said is sent on, so a pause in the middle of a thought does not split it. */
const SETTLE_MS = 900;

/** Name colours, one per seat. */
const COLORS = ["#1a73e8", "#e0457b", "#2e9e5b", "#d98324"];
const DEFAULT_MEMBERS = ["professor", "luna", "rex"];

function loadMembers(valid: string[], min: number, max: number): string[] {
  try {
    const saved = JSON.parse(loadPref("groupMembers", "null")) as unknown;
    if (Array.isArray(saved)) {
      const ids = saved.filter((id): id is string => typeof id === "string" && valid.includes(id)).slice(0, max);
      if (ids.length >= min) return ids;
    }
  } catch {
    // Fall through to the default table.
  }
  return DEFAULT_MEMBERS.filter((id) => valid.includes(id)).slice(0, max);
}

/** Group conversation: up to four characters around a table talk with the student and with each other. */
export default function GroupChat({ config, language, level, speechTag, studentName, showScene, transcript, onBusyChange }: Props) {
  const { t } = useTranslation();
  const { min, max, characters, scenes } = config.group;
  const validIds = useMemo(() => characters.map((c) => c.id), [characters]);
  const [members, setMembers] = useState(() => loadMembers(validIds, min, max));
  const [sceneId, setSceneId] = useState(() => loadPref("groupScene", scenes[0].id));
  const [topic, setTopic] = useState("");
  // The room designed for the student's own topic; null while a ready-made scene is used.
  const [customStyle, setCustomStyle] = useState<SceneStyle | null>(null);
  // A painted picture of the wall for that topic (an object URL), which arrives a few seconds later.
  const [backdrop, setBackdrop] = useState<string | null>(null);
  // True from pressing Start with an own topic until its picture has arrived or failed.
  const [painting, setPainting] = useState(false);
  const styling = useRef<AbortController | null>(null);
  const [roomNote, setRoomNote] = useState<string | null>(null);
  const [voicesOn, setVoicesOn] = useState(() => loadPref("groupVoices", "on") === "on");
  const [input, setInput] = useState("");
  const [micOn, setMicOn] = useState(false);
  const [interim, setInterim] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const seats = useMemo<Seat[]>(
    () =>
      members.flatMap((id) => {
        const info = characters.find((c) => c.id === id);
        const character = CHARACTERS.find((c) => c.id === id);
        return info && character ? [{ id, name: info.name, color: COLORS[members.indexOf(id) % COLORS.length], character }] : [];
      }),
    [members, characters],
  );
  const nameOf = (id: string) => (id === "user" ? t("chat.you") : (characters.find((c) => c.id === id)?.name ?? id));
  const colorOf = (id: string) => (id === "user" ? "var(--accent)" : COLORS[Math.max(0, members.indexOf(id)) % COLORS.length]);

  const group = useGroupChat({
    language,
    level,
    studentName,
    participants: members,
    voice: voicesOn,
    fallbackFor: (id) => ({ tag: speechTag, ...(CHARACTERS.find((c) => c.id === id)?.speech ?? { pitch: 1, rate: 1 }) }),
  });
  const running = group.status === "running";
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [group.messages, interim]);

  // When the phrase being recognised now began to arrive, which decides whether it can hold the group's voices.
  const phraseStart = useRef<number | null>(null);
  /** The student's own words in a phrase the microphone heard, with any echo of the group's voices taken out. */
  const ownWords = (text: string) => studentWords(text, (phraseStart.current ??= Date.now()), group.lastHeardAt(), group.heardLines());

  // What the student has said by voice and not yet sent. People pause mid-thought and the browser ends a phrase at every
  // pause, so each phrase is held for a moment: if another follows, they go to the group together as one message.
  const heard = useRef<{ text: string; timer?: number }>({ text: "" });
  const holdHeard = () => window.clearTimeout(heard.current.timer);
  function sendHeard() {
    holdHeard();
    const text = heard.current.text.trim();
    heard.current.text = "";
    setInterim("");
    if (text) group.say(text);
  }
  useEffect(() => holdHeard, []);

  const recognizer = useRecognizer({
    lang: speechTag,
    shouldListen: () => micOn,
    // The microphone stays open while the group talks, so the student can talk over them. The group's own voices come
    // back through the speakers, so anything that is only an echo of the last lines is ignored.
    onInterim: (text) => {
      const { own, novel } = ownWords(text);
      if (painting || !own) return;
      setInterim(own);
      holdHeard(); // Still speaking: whatever was held is not finished yet.
      // As soon as the student really starts to speak, the group stops talking and listens. Only words the group was not
      // saying count: garbled echo of their own lines must not cut them off.
      if (running && novel >= 2) group.interrupt();
    },
    onFinal: (text) => {
      const { own } = ownWords(text);
      phraseStart.current = null; // Whatever is heard next is a new phrase.
      if (painting || !own) return;
      heard.current.text = `${heard.current.text} ${own}`.trim();
      setInterim(heard.current.text); // Shown while it waits to see whether more follows.
      holdHeard();
      heard.current.timer = window.setTimeout(sendHeard, SETTLE_MS);
    },
    onEnd: () => {
      phraseStart.current = null;
    },
    onError: (code) => {
      const problem = recognitionProblem(code, language);
      if (problem) {
        setNotice(problem);
        setMicOn(false);
      }
    },
  });

  // Keep listening while the mic is on.
  const { listening, start: startListening } = recognizer;
  useEffect(() => {
    if (!micOn || !recognizer.supported || listening) return;
    const timer = setTimeout(startListening, 200);
    return () => clearTimeout(timer);
  }, [micOn, recognizer.supported, listening, startListening]);

  function toggleMember(id: string) {
    const next = members.includes(id) ? members.filter((m) => m !== id) : members.length < max ? [...members, id] : members;
    if (next.length < min || next === members) return;
    setMembers(next);
    savePref("groupMembers", JSON.stringify(next));
  }

  function toggleMic() {
    if (micOn) {
      setMicOn(false);
      recognizer.stop();
      return;
    }
    setMicOn(true);
    setNotice(null);
    startListening();
  }

  function stopConversation() {
    // Also cancels a scene that is still being prepared: the group will not start.
    styling.current?.abort();
    setPainting(false);
    holdHeard();
    heard.current.text = "";
    group.interrupt();
    setMicOn(false);
    recognizer.stop();
    setInterim("");
  }

  function exportTranscript() {
    exportConversation(
      t("exportTitle.group", { language: languageInline(t, language), level }),
      group.messages.map((m) => ({ speaker: m.speaker === "user" ? (studentName || t("chat.you")) : nameOf(m.speaker), text: m.text, interrupted: m.interrupted })),
      `group-${language}-${level}`,
    );
  }

  const sceneValue = topic.trim() || sceneId;

  /**
   * Starts the scene. For the student's own topic the room is prepared first, and the group only begins to talk once
   * its picture has loaded, so they never speak in a room that is about to change. If the picture cannot be made the
   * standard room is used and the group starts anyway.
   */
  async function startScene() {
    styling.current?.abort();
    const own = topic.trim();
    setBackdrop(null);
    setRoomNote(null);
    group.unlock(); // Browsers only allow sound after a click, and the group starts later.
    if (!own || !showScene) {
      setCustomStyle(null);
      setPainting(false);
      group.start(sceneValue);
      return;
    }

    const controller = new AbortController();
    styling.current = controller;
    group.reset();
    setPainting(true);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(PREPARE_TIMEOUT_MS)]);
    const [style, picture] = await Promise.allSettled([
      fetchSceneStyle(own, signal),
      // A picture that cannot be read as an image counts as a failure, like one that never arrives.
      fetchBackdrop(own, signal).then(async (blob) => (await createImageBitmap(blob).then((bitmap) => bitmap.close()), blob)),
    ]);
    if (controller.signal.aborted) return; // Stopped, or another scene was started.

    setCustomStyle(style.status === "fulfilled" ? styleFromServer(style.value) : null);
    if (picture.status === "fulfilled") setBackdrop(URL.createObjectURL(picture.value));
    else setRoomNote(t("group.pictureFailed"));
    setPainting(false);
    group.start(sceneValue);
  }
  // Pictures are released when replaced or when the table is left.
  useEffect(() => () => { if (backdrop) URL.revokeObjectURL(backdrop); }, [backdrop]);
  useEffect(() => () => styling.current?.abort(), []);
  // While the room is prepared nothing else can be done, here or in the settings above.
  useEffect(() => {
    onBusyChange?.(painting);
    return () => onBusyChange?.(false);
  }, [painting, onBusyChange]);
  const roomStyle = useMemo(() => customStyle ?? presetStyle(sceneId), [customStyle, sceneId]);
  const last = group.messages[group.messages.length - 1];
  const statusText = painting
    ? t("group.preparing")
    : group.status === "idle"
      ? t("group.statusIdle")
      : running
        ? micOn
          ? t("group.statusTalkingMic")
          : t("group.statusTalking")
        : t("group.statusYourTurn");

  return (
    <>
      <fieldset className="group-setup" aria-label={t("group.setup")} disabled={painting}>
        <div className="group-members">
          <span className="group-label">{t("group.atTable", { count: members.length, max })}</span>
          <div className="chips">
            {characters.map((c) => {
              const selected = members.includes(c.id);
              const atMax = !selected && members.length >= max;
              const atMin = selected && members.length <= min;
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`member${selected ? " selected" : ""}`}
                  style={selected ? ({ "--member": COLORS[members.indexOf(c.id) % COLORS.length] } as React.CSSProperties) : undefined}
                  aria-pressed={selected}
                  disabled={atMax || atMin}
                  title={atMax ? t("group.upTo", { max }) : atMin ? t("group.atLeast", { min }) : characterRole(t, c.id, c.role)}
                  onClick={() => toggleMember(c.id)}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>
        <div className="group-scene-options">
          <label>
            {t("group.scene")}
            <select
              value={sceneId}
              onChange={(e) => {
                setSceneId(e.target.value);
                savePref("groupScene", e.target.value);
              }}
            >
              {scenes.map((s) => (
                <option key={s.id} value={s.id}>
                  {sceneTitle(t, s.id, s.title)}
                </option>
              ))}
            </select>
          </label>
          <label className="grow">
            {t("group.ownTopic")}
            <input value={topic} maxLength={120} onChange={(e) => setTopic(e.target.value)} placeholder={t("group.topicPlaceholder")} />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={voicesOn}
              onChange={(e) => {
                setVoicesOn(e.target.checked);
                savePref("groupVoices", e.target.checked ? "on" : "off");
              }}
            />
            {t("group.voices")}
          </label>
          <button type="button" className="primary" onClick={startScene}>
            {group.status === "idle" ? t("group.startScene") : t("group.restartScene")}
          </button>
        </div>
      </fieldset>

      {showScene && (
        <Suspense fallback={<div className="avatar group-scene" />}>
          <GroupScene seats={seats} style={roomStyle} backdrop={backdrop} busyText={painting ? t("group.painting") : null} analyserFor={group.analyserFor} speakingId={group.speakingId} thinkingId={group.thinkingId} addresseeId={group.addresseeId} />
        </Suspense>
      )}

      <p className="group-status" aria-live="polite">
        {statusText}
        {group.thinkingId && !showScene && <span> {t("group.aboutToSpeak", { name: nameOf(group.thinkingId) })}</span>}
      </p>
      {group.error && <p className="notice error">{group.error}</p>}
      {voicesOn && !group.voiceStatus.natural && (
        <p className="notice">
          {t("group.browserVoices")}
          {group.voiceStatus.reason ? ` (${group.voiceStatus.reason.slice(0, 160)})` : ""}
        </p>
      )}
      {notice && <p className="notice error">{notice}</p>}
      {roomNote && <p className="notice">{roomNote}</p>}
      {!recognizer.supported && <p className="notice">{t("notices.voiceInputUnsupported")}</p>}

      {!transcript.show && last && (
        <p className="caption">
          <strong style={{ color: colorOf(last.speaker) }}>{nameOf(last.speaker)}</strong> {last.text}
        </p>
      )}

      <div className="toolbar">
        <ConversationControls
          canStop={painting || running || micOn || listening || group.thinkingId !== null || group.speakingId !== null}
          canExport={group.messages.length > 0}
          locked={painting}
          onStop={stopConversation}
          onExport={exportTranscript}
        />
        <button type="button" className="toggle" aria-pressed={transcript.show} onClick={transcript.toggle}>
          💬 {transcript.show ? t("toolbar.hideTranscript") : t("toolbar.showTranscript")}
          {!transcript.show && group.messages.length > 0 ? ` (${group.messages.length})` : ""}
        </button>
      </div>

      <div ref={logRef} className={`log${transcript.show ? "" : " collapsed"}`}>
        {transcript.show &&
          group.messages.map((m) => (
            <div key={m.id} className={`entry ${m.speaker === "user" ? "user" : "assistant"}`}>
              {m.speaker !== "user" && (
                <span className="speaker-name" style={{ color: colorOf(m.speaker) }}>
                  {nameOf(m.speaker)}
                </span>
              )}
              <div className={`msg ${m.speaker === "user" ? "user" : "assistant"}`} style={m.speaker === "user" ? undefined : { borderInlineStart: `4px solid ${colorOf(m.speaker)}` }}>
                {m.text}
                {m.interrupted && <span className="cut"> —</span>}
              </div>
              <MessageTools
                text={m.text}
                role={m.speaker === "user" ? "user" : "assistant"}
                languages={config.languages.map((l) => l.name)}
                defaultTarget={language === "English" ? "Turkish" : "English"}
              />
            </div>
          ))}
        {transcript.show && interim && <div className="msg user interim">🎤 {interim}</div>}
        {micOn && !interim && (
          <div className="mic-status">{listening ? `🎤 ${t("mic.listening")}` : t("mic.on")}</div>
        )}
      </div>

      <div className="dock">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (painting) return;
            sendHeard(); // Anything just said by voice goes first, so the group gets it all in order.
            group.say(input);
            setInput("");
          }}
        >
          <button
            type="button"
            className={`mic${micOn ? " on" : ""}${listening ? " live" : ""}`}
            onClick={toggleMic}
            disabled={!recognizer.supported || painting}
            aria-label={micOn ? t("mic.turnOff") : t("mic.turnOn")}
            title={micOn ? t("mic.titleOn") : t("mic.titleOff")}
          >
            🎤
          </button>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={t("group.sayIn", { language: languageInline(t, language) })} autoComplete="off" disabled={painting} />
          {running ? (
            <button type="button" onClick={group.interrupt} disabled={painting}>
              {t("chat.stop")}
            </button>
          ) : group.status === "waiting" && !input.trim() ? (
            <button type="button" onClick={group.keepTalking} disabled={painting}>
              {t("group.keepTalking")}
            </button>
          ) : (
            <button type="submit" disabled={!input.trim() || painting}>
              {t("chat.send")}
            </button>
          )}
        </form>
      </div>
    </>
  );
}
