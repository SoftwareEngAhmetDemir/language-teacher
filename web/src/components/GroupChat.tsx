import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { CHARACTERS } from "../avatar/characters";
import type { Seat } from "../avatar/GroupScene";
import MessageTools from "./MessageTools";
import ConversationControls from "./ConversationControls";
import { exportConversation } from "../lib/exportConversation";
import { useGroupChat } from "../hooks/useGroupChat";
import { useRecognizer } from "../hooks/useRecognizer";
import { presetStyle, styleFromServer, type SceneStyle } from "../avatar/sceneStyle";
import { fetchSceneStyle, type Config } from "../lib/api";
import { loadPref, savePref } from "../lib/prefs";

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
}

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
export default function GroupChat({ config, language, level, speechTag, studentName, showScene, transcript }: Props) {
  const { min, max, characters, scenes } = config.group;
  const validIds = useMemo(() => characters.map((c) => c.id), [characters]);
  const [members, setMembers] = useState(() => loadMembers(validIds, min, max));
  const [sceneId, setSceneId] = useState(() => loadPref("groupScene", scenes[0].id));
  const [topic, setTopic] = useState("");
  // The room designed for the student's own topic; null while a ready-made scene is used.
  const [customStyle, setCustomStyle] = useState<SceneStyle | null>(null);
  const styling = useRef<AbortController | null>(null);
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
  const nameOf = (id: string) => (id === "user" ? "You" : (characters.find((c) => c.id === id)?.name ?? id));
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

  const recognizer = useRecognizer({
    lang: speechTag,
    shouldListen: () => micOn && !running,
    onInterim: setInterim,
    onFinal: (text) => {
      setInterim("");
      group.say(text);
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

  // The microphone shuts while the group talks. Left open it would hear them through the speakers and take it for the
  // student speaking, which cuts the group off in the middle of a line.
  const { stop: stopListening } = recognizer;
  useEffect(() => {
    if (running) stopListening();
  }, [running, stopListening]);

  // Keep listening while the mic is on, pausing while the group talks so it doesn't hear itself.
  const { listening, start: startListening } = recognizer;
  useEffect(() => {
    if (!micOn || !recognizer.supported || running || listening) return;
    const timer = setTimeout(startListening, 200);
    return () => clearTimeout(timer);
  }, [micOn, recognizer.supported, running, listening, startListening]);

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
    if (!running) startListening();
  }

  function stopConversation() {
    group.interrupt();
    setMicOn(false);
    recognizer.stop();
    setInterim("");
  }

  function exportTranscript() {
    exportConversation(
      `Group conversation in ${language} (${level})`,
      group.messages.map((m) => ({ speaker: m.speaker === "user" ? (studentName || "You") : nameOf(m.speaker), text: m.text, interrupted: m.interrupted })),
    );
  }

  const sceneValue = topic.trim() || sceneId;

  /** Starts the scene, and for the student's own topic has the room redecorated to suit it while the group begins talking. */
  function startScene() {
    group.start(sceneValue);
    styling.current?.abort();
    const own = topic.trim();
    if (!own) {
      setCustomStyle(null);
      return;
    }
    const controller = new AbortController();
    styling.current = controller;
    fetchSceneStyle(own, controller.signal)
      .then((raw) => {
        if (!controller.signal.aborted) setCustomStyle(styleFromServer(raw));
      })
      .catch(() => {
        // The room simply stays as it is; the conversation does not depend on it.
      });
  }
  useEffect(() => () => styling.current?.abort(), []);
  const roomStyle = useMemo(() => customStyle ?? presetStyle(sceneId), [customStyle, sceneId]);
  const last = group.messages[group.messages.length - 1];
  const statusText =
    group.status === "idle"
      ? "Choose who sits at the table, pick a scene and press Start."
      : running
        ? "The group is talking. Press Stop, or type, to jump in."
        : "Your turn. Say something, or let them keep talking.";

  return (
    <>
      <section className="group-setup" aria-label="Group setup">
        <div className="group-members">
          <span className="group-label">At the table ({members.length} of {max})</span>
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
                  title={atMax ? `Up to ${max} people` : atMin ? `At least ${min} people` : c.role}
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
            Scene
            <select
              value={sceneId}
              onChange={(e) => {
                setSceneId(e.target.value);
                savePref("groupScene", e.target.value);
              }}
            >
              {scenes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
          <label className="grow">
            Own topic (optional)
            <input value={topic} maxLength={120} onChange={(e) => setTopic(e.target.value)} placeholder="For example: my favourite film" />
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
            Voices
          </label>
          <button type="button" className="primary" onClick={startScene}>
            {group.status === "idle" ? "Start scene" : "Restart scene"}
          </button>
        </div>
      </section>

      {showScene && (
        <Suspense fallback={<div className="avatar group-scene" />}>
          <GroupScene seats={seats} style={roomStyle} analyserFor={group.analyserFor} speakingId={group.speakingId} thinkingId={group.thinkingId} addresseeId={group.addresseeId} />
        </Suspense>
      )}

      <p className="group-status" aria-live="polite">
        {statusText}
        {group.thinkingId && !showScene && <span> {nameOf(group.thinkingId)} is about to speak…</span>}
      </p>
      {group.error && <p className="notice error">{group.error}</p>}
      {voicesOn && !group.voiceStatus.natural && (
        <p className="notice">
          The characters' natural voices aren't available right now, so your browser's voices are being used instead.
          {group.voiceStatus.reason ? ` (${group.voiceStatus.reason.slice(0, 160)})` : ""}
        </p>
      )}
      {notice && <p className="notice error">{notice}</p>}
      {!recognizer.supported && <p className="notice">Voice input isn't supported in this browser. Use Chrome, Edge or Safari, or type instead.</p>}

      {!transcript.show && last && (
        <p className="caption">
          <strong style={{ color: colorOf(last.speaker) }}>{nameOf(last.speaker)}</strong> {last.text}
        </p>
      )}

      <div className="toolbar">
        <ConversationControls
          canStop={running || micOn || listening || group.thinkingId !== null || group.speakingId !== null}
          canExport={group.messages.length > 0}
          onStop={stopConversation}
          onExport={exportTranscript}
        />
        <button type="button" className="toggle" aria-pressed={transcript.show} onClick={transcript.toggle}>
          💬 {transcript.show ? "Hide transcript" : "Show transcript"}
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
              <div className={`msg ${m.speaker === "user" ? "user" : "assistant"}`} style={m.speaker === "user" ? undefined : { borderLeft: `4px solid ${colorOf(m.speaker)}` }}>
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
          <div className="mic-status">{listening ? "🎤 Listening…" : running ? "Microphone on · paused while the group talks" : "Microphone on"}</div>
        )}
      </div>

      <div className="dock">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            group.say(input);
            setInput("");
          }}
        >
          <button
            type="button"
            className={`mic${micOn ? " on" : ""}${listening ? " live" : ""}`}
            onClick={toggleMic}
            disabled={!recognizer.supported}
            aria-label={micOn ? "Turn microphone off" : "Turn microphone on"}
            title={micOn ? "Microphone on. Click to turn off" : "Click to turn the microphone on"}
          >
            🎤
          </button>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={`Say something in ${language}…`} autoComplete="off" />
          {running ? (
            <button type="button" onClick={group.interrupt}>
              Stop
            </button>
          ) : group.status === "waiting" && !input.trim() ? (
            <button type="button" onClick={group.keepTalking}>
              Keep talking
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()}>
              Send
            </button>
          )}
        </form>
      </div>
    </>
  );
}
