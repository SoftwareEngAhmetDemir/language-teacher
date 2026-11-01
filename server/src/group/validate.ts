import { isCharacterId } from "../characters.js";
import { parseProfile, parseStudentName } from "../teacher.js";
import type { Line, RoundRequest } from "./types.js";
import { sceneBrief } from "./scenes.js";

export const MIN_PARTICIPANTS = 2;
export const MAX_PARTICIPANTS = 4;
const MAX_TRANSCRIPT_LINES = 40;
const MAX_LINE_CHARS = 600;
const MAX_TOPIC_CHARS = 120;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Checks a client request for a round and turns it into trusted input. Everything the client sends is
 * checked against allowlists or length limits, because it ends up inside prompts.
 */
export function parseRound(body: unknown, maxTurns: number): Parsed<RoundRequest> {
  const b = (body ?? {}) as Record<string, unknown>;
  const profile = parseProfile(b.language, b.level);
  if (!profile) return { ok: false, error: "`language` or `level` is not supported" };

  const ids = b.participants;
  if (!Array.isArray(ids) || ids.length < MIN_PARTICIPANTS || ids.length > MAX_PARTICIPANTS) {
    return { ok: false, error: `\`participants\` must list ${MIN_PARTICIPANTS} to ${MAX_PARTICIPANTS} characters` };
  }
  if (!ids.every(isCharacterId) || new Set(ids).size !== ids.length) {
    return { ok: false, error: "`participants` must be distinct, known character ids" };
  }
  const participants = ids as string[];

  const raw = b.transcript ?? [];
  if (!Array.isArray(raw)) return { ok: false, error: "`transcript` must be a list" };
  const transcript: Line[] = [];
  for (const entry of raw.slice(-MAX_TRANSCRIPT_LINES)) {
    const line = entry as Record<string, unknown>;
    const speaker = line?.speaker;
    const text = line?.text;
    if (typeof text !== "string" || typeof speaker !== "string") return { ok: false, error: "Each transcript line needs `speaker` and `text`" };
    if (speaker !== "user" && !participants.includes(speaker)) return { ok: false, error: "A transcript line is from someone who is not at the table" };
    const clean = text.trim().slice(0, MAX_LINE_CHARS);
    if (clean) transcript.push({ speaker, text: clean });
  }

  // A known scene id gives its brief; otherwise the text is the student's own topic.
  // The student's own topic goes on a single line so it can't add structure to the prompt.
  const sceneInput = typeof b.scene === "string" ? b.scene.replace(/\s+/g, " ").trim() : "";
  const scene = sceneBrief(sceneInput) ?? (sceneInput ? `The group talks about: ${sceneInput.slice(0, MAX_TOPIC_CHARS)}` : sceneBrief("cafe")!);

  return { ok: true, value: { language: profile.language, level: profile.level, participants, transcript, scene, studentName: parseStudentName(b.studentName), maxTurns } };
}
