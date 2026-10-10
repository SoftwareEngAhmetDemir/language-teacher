import { CHARACTER_PROFILES } from "../characters.js";
import type { Decision, Line } from "./types.js";

/** What the conductor needs to know to pick the next speaker. */
export interface FloorState {
  participants: string[];
  transcript: Line[];
  /** AI turns already taken in this round. */
  turns: number;
  maxTurns: number;
}

const nameOf = (id: string) => CHARACTER_PROFILES[id]?.name ?? id;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Where `name` first appears in `text` as a whole word (any word of it of 3+ letters counts, so "Rex" or "Professor" will do), or -1. */
export function mentionIndex(text: string, name: string): number {
  let best = -1;
  for (const word of name.split(/\s+/)) {
    if (word.length < 3) continue;
    const match = new RegExp(`(^|[^\\p{L}])${escapeRegExp(word)}($|[^\\p{L}])`, "iu").exec(text);
    if (match) {
      const at = match.index + match[1].length;
      if (best < 0 || at < best) best = at;
    }
  }
  return best;
}

/** Whether `text` mentions the character by name. */
export function mentions(text: string, id: string): boolean {
  return mentionIndex(text, nameOf(id)) >= 0;
}

/**
 * Works out who a line was said to, so the people at the table can look at each other:
 * whoever is called by name first (another character, or the student by their name); else the person the
 * conductor intended; else the person who spoke just before (a reply), or the student if they spoke last.
 * Returns undefined for a remark to the whole table.
 */
export function detectAddressee(args: {
  text: string;
  speaker: string;
  participants: string[];
  /** The conversation before this line. */
  transcript: Line[];
  studentName?: string;
  /** Who the conductor said the line was for. */
  suggested?: string;
}): string | undefined {
  const { text, speaker, participants, transcript, studentName, suggested } = args;
  const others = participants.filter((p) => p !== speaker);

  const called = [
    ...others.map((id) => ({ id, at: mentionIndex(text, nameOf(id)) })),
    ...(studentName ? [{ id: "user", at: mentionIndex(text, studentName) }] : []),
  ]
    .filter((c) => c.at >= 0)
    .sort((a, b) => a.at - b.at)[0];
  if (called) return called.id;

  if (suggested === "user" || (suggested && others.includes(suggested))) return suggested;

  const last = transcript[transcript.length - 1];
  if (last?.speaker === "user") return "user";
  if (last && last.speaker !== speaker) return last.speaker;
  return undefined;
}

/**
 * A rule-based choice of next speaker, used when the model's choice is unusable. Prefers whoever was just
 * addressed, then the teacher when the student has just spoken, then whoever has spoken least recently.
 */
export function pickNext(state: FloorState, exclude: string[] = []): string {
  const candidates = state.participants.filter((p) => !exclude.includes(p));
  const pool = candidates.length ? candidates : state.participants;
  const last = state.transcript[state.transcript.length - 1];

  if (last) {
    const addressed = pool.find((p) => p !== last.speaker && mentions(last.text, p));
    if (addressed) return addressed;
    if (last.speaker === "user") {
      const teacher = pool.find((p) => p === "professor");
      if (teacher) return teacher;
    }
  }
  const lastSpoke = (id: string) => {
    for (let i = state.transcript.length - 1; i >= 0; i--) if (state.transcript[i].speaker === id) return i;
    return -1;
  };
  return pool.reduce((best, p) => (lastSpoke(p) < lastSpoke(best) ? p : best), pool[0]);
}

/**
 * Turns the model's suggestion into a decision the conversation can safely follow:
 * - someone always responds at the start of a round, and the round ends after `maxTurns` lines;
 * - the chosen speaker has to be at the table, and nobody speaks twice in a row.
 */
export function guard(suggestion: Decision | null, state: FloorState): Decision {
  if (state.turns >= state.maxTurns) return { next: "user", direction: "", yielded: "budget" };

  const direction = (suggestion?.direction ?? "").trim().slice(0, 200);
  if (suggestion?.next === "user" && state.turns > 0) return { next: "user", direction: "", yielded: "conductor" };
  const to = suggestion?.to;

  const last = state.transcript[state.transcript.length - 1];
  let next = suggestion?.next;
  if (!next || next === "user" || !state.participants.includes(next)) next = pickNext(state);
  if (last && last.speaker === next) next = pickNext(state, [next]);
  // Who they will talk to has to be someone else at the table, or the student.
  const addressed = to === "user" || (to && to !== next && state.participants.includes(to)) ? to : undefined;
  return { next, direction, to: addressed };
}
