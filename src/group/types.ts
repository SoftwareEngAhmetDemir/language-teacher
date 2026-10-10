import type { Level } from "../teacher.js";

/** A character id, or "user" for the student. */
export type SpeakerId = string;

export interface Line {
  speaker: SpeakerId;
  text: string;
}

/** One round of conversation: the AI participants take a few turns, then hand back to the student. */
export interface RoundRequest {
  language: string;
  level: Level;
  /** Character ids at the table, 2 to 5. */
  participants: string[];
  /** The conversation so far, as the student has seen and heard it. */
  transcript: Line[];
  /** What the scene is about, in plain words. */
  scene: string;
  /** What to call the student, if they gave a name. */
  studentName?: string;
  /** Most AI turns in this round. */
  maxTurns: number;
}

/** Events streamed to the browser while a round runs. */
export type GroupEvent =
  | { type: "start"; speaker: string }
  | { type: "delta"; speaker: string; text: string }
  /** `addressee` is who the line was said to: a character id, "user" for the student, or nothing for the whole table. */
  | { type: "end"; speaker: string; text: string; addressee?: string }
  | { type: "done"; awaitUser: boolean }
  | { type: "error"; message: string };

export interface Decision {
  /** A participant id, or "user" to hand the floor to the student. */
  next: string;
  /** A short private note for the speaker, such as "react to Rex's joke". */
  direction: string;
  /** Who the next speaker will talk to: a character id, "user", or undefined for everyone. */
  to?: string;
  /** Why the round is handing over, when it is. */
  yielded?: "conductor" | "budget";
}
