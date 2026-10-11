import { useCallback, useEffect, useRef, useState } from "react";
import { streamGroupRound } from "../lib/api";
import { GroupPlayer, type SpokenLine } from "../lib/groupPlayer";

export interface GroupMessage {
  id: number;
  /** A character id, or "user". */
  speaker: string;
  text: string;
  /** The line was cut off because the student jumped in. */
  interrupted?: boolean;
}

export type GroupStatus = "idle" | "running" | "waiting";

interface Options {
  language: string;
  level: string;
  /** What the characters call the student. */
  studentName?: string;
  participants: string[];
  /** Browser-voice fallback settings for a character. */
  fallbackFor: (id: string) => { tag: string; pitch: number; rate: number };
  /** Whether lines are spoken aloud. */
  voice: boolean;
}

/** How many times in a row the characters may carry on among themselves before waiting for the student. */
const AUTO_ROUNDS = 2;

/**
 * Runs a group conversation: asks the server for a round of lines, plays them in each character's
 * voice, and lets the student jump in at any moment by interrupting what is being said.
 */
export function useGroupChat(options: Options) {
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [status, setStatus] = useState<GroupStatus>("idle");
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [thinkingId, setThinkingId] = useState<string | null>(null);
  // Who the current line is said to, so the speaker and that person can look at each other.
  const [addresseeId, setAddresseeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Whether lines are heard in the characters' natural Gemini voices, or the browser's (and why not).
  const [voiceStatus, setVoiceStatus] = useState<{ natural: boolean; reason?: string }>({ natural: true });

  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  // What the student has seen and heard, kept in step with state so a new round can start straight away.
  const shown = useRef<GroupMessage[]>([]);
  // Lines the server has written that are waiting their turn to be heard. They belong in the next round's transcript,
  // so the next round can be started before they have all been spoken.
  const pending = useRef<{ id: number; speaker: string; text: string }[]>([]);
  const nextId = useRef(1);
  // Bumped whenever the student interrupts or the scene restarts, so a stale round stops quietly.
  const token = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const scene = useRef("cafe");
  const player = useRef<GroupPlayer | null>(null);

  const add = useCallback((message: Omit<GroupMessage, "id">) => {
    const full = { ...message, id: nextId.current++ };
    shown.current = [...shown.current, full];
    setMessages(shown.current);
  }, []);

  const getPlayer = useCallback(() => {
    if (!player.current) {
      player.current = new GroupPlayer(
        {
          onVoice: (natural, reason) => setVoiceStatus({ natural, reason }),
          onStart: (line) => {
            pending.current = pending.current.filter((p) => p.id !== line.id);
            add({ speaker: line.speaker, text: line.text });
            setSpeakingId(line.speaker);
            setAddresseeId(line.addressee ?? null);
            setThinkingId((id) => (id === line.speaker ? null : id));
          },
          onEnd: (line, completed) => {
            setSpeakingId((id) => (id === line.speaker ? null : id));
            setAddresseeId(null);
            if (!completed) {
              shown.current = shown.current.map((m, i) => (i === shown.current.length - 1 && m.speaker === line.speaker ? { ...m, interrupted: true } : m));
              setMessages(shown.current);
            }
          },
        },
        () => latest.current.voice,
      );
    }
    return player.current;
  }, [add]);

  const runRound = useCallback(
    async (myToken: number, autoLeft: number) => {
      const current = latest.current;
      const abort = new AbortController();
      controller.current?.abort();
      controller.current = abort;
      setStatus("running");
      setError(null);

      let awaitUser = false;
      let failed = false;
      const audio = getPlayer();
      try {
        for await (const event of streamGroupRound(
          {
            language: current.language,
            level: current.level,
            participants: current.participants,
            transcript: [...shown.current, ...pending.current].map(({ speaker, text }) => ({ speaker, text })),
            scene: scene.current,
            studentName: current.studentName,
          },
          abort.signal,
        )) {
          if (myToken !== token.current) return;
          if (event.type === "start") setThinkingId(event.speaker);
          else if (event.type === "end") {
            const line: SpokenLine = { id: nextId.current++, speaker: event.speaker, text: event.text, addressee: event.addressee, fallback: latest.current.fallbackFor(event.speaker) };
            pending.current = [...pending.current, { id: line.id, speaker: line.speaker, text: line.text }];
            audio.enqueue(line);
          } else if (event.type === "done") awaitUser = event.awaitUser;
          else if (event.type === "error") {
            failed = true;
            setError(event.message);
          }
        }
      } catch (err) {
        if (abort.signal.aborted || myToken !== token.current) return;
        failed = true;
        setError(err instanceof Error ? err.message : "The group conversation failed");
      }

      if (!awaitUser && !failed && autoLeft > 0) {
        // The group carries on by itself: start writing the next round while the last lines of this one are still
        // being spoken, so there is no silent gap while the next lines are prepared.
        await audio.whenBacklogAtMost(2);
        if (myToken !== token.current) return;
        void runRound(myToken, autoLeft - 1);
        return;
      }
      // The floor is the student's: let everything finish playing first.
      await audio.whenIdle();
      if (myToken !== token.current) return;
      setThinkingId(null);
      setStatus("waiting");
    },
    [getPlayer],
  );

  /** Cuts off whoever is talking and drops anything still being generated. */
  const interrupt = useCallback(() => {
    token.current++;
    controller.current?.abort();
    player.current?.stop();
    pending.current = [];
    setThinkingId(null);
    setSpeakingId(null);
    setAddresseeId(null);
    // The floor goes back to the student, unless the scene has not started yet.
    setStatus((s) => (s === "idle" ? s : "waiting"));
  }, []);

  /** Starts a scene from scratch. `sceneText` is a scene id or the student's own topic. */
  const start = useCallback(
    (sceneText: string) => {
      interrupt();
      shown.current = [];
      pending.current = [];
      setMessages([]);
      scene.current = sceneText;
      getPlayer().unlock();
      void runRound(token.current, AUTO_ROUNDS);
    },
    [interrupt, getPlayer, runRound],
  );

  /** The student says something, over anyone who is talking. */
  const say = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || latest.current.participants.length < 2) return;
      interrupt();
      getPlayer().unlock();
      add({ speaker: "user", text: trimmed });
      void runRound(token.current, AUTO_ROUNDS);
    },
    [interrupt, getPlayer, add, runRound],
  );

  /** Lets the characters carry on among themselves. */
  const keepTalking = useCallback(() => {
    interrupt();
    getPlayer().unlock();
    void runRound(token.current, AUTO_ROUNDS);
  }, [interrupt, getPlayer, runRound]);

  /** Ends the scene and clears the table. */
  const reset = useCallback(() => {
    interrupt();
    shown.current = [];
    pending.current = [];
    setMessages([]);
    setStatus("idle");
    setError(null);
  }, [interrupt]);

  // When the language, level or table changes, the conversation no longer makes sense.
  const tableKey = `${options.language}|${options.level}|${options.studentName ?? ""}|${options.participants.join(",")}`;
  useEffect(() => reset, [tableKey, reset]);

  useEffect(
    () => () => {
      token.current++;
      controller.current?.abort();
      player.current?.dispose();
      player.current = null;
    },
    [],
  );

  /** Lets the browser play audio. Call it from a click, before anything that has to wait. */
  const unlock = useCallback(() => getPlayer().unlock(), [getPlayer]);

  const analyserFor = useCallback((id: string) => player.current?.analyserFor(id) ?? null, []);

  return { messages, status, speakingId, thinkingId, addresseeId, voiceStatus, error, start, say, keepTalking, interrupt, reset, unlock, analyserFor };
}
