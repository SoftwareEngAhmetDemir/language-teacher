import { CHARACTER_PROFILES } from "../characters.js";
import { levelRules } from "../teacher.js";
import type { Line, RoundRequest } from "./types.js";

/** Only the latest lines are sent to the models: a short prompt is answered sooner, and old lines rarely matter. */
const SPEAKER_CONTEXT = 20;
const CONDUCTOR_CONTEXT = 12;

const nameOf = (id: string) => CHARACTER_PROFILES[id]?.name ?? id;

/** What the student is called in the script: their own name, or "Student". */
export function studentLabel(studentName?: string): string {
  if (!studentName) return "Student";
  const taken = Object.values(CHARACTER_PROFILES).some((c) => c.name.toLowerCase() === studentName.toLowerCase());
  return taken ? `${studentName} (student)` : studentName;
}

/** The conversation as a script, one line per turn. */
export function script(transcript: Line[], studentName?: string): string {
  return transcript.map((l) => `${l.speaker === "user" ? studentLabel(studentName) : nameOf(l.speaker)}: ${l.text}`).join("\n");
}

function roster(participants: string[], exceptId?: string): string {
  return participants
    .filter((id) => id !== exceptId)
    .map((id) => `- ${nameOf(id)}: ${CHARACTER_PROFILES[id].groupRole}`)
    .join("\n");
}

/** Instructions for one character's turn in the group conversation. */
export function speakerInstruction(req: RoundRequest, id: string): string {
  const me = CHARACTER_PROFILES[id];
  const others = roster(req.participants, id);
  return `You are ${me.name}, taking part in a friendly group conversation in ${req.language}. At the table with you are the student (a language learner${req.studentName ? `, called ${req.studentName}` : ""}) and:
${others}

${me.persona}
Your role in the group: ${me.groupRole}.
Personality only changes your tone and manner. It never overrides the language, the level limits or the rules below.

Everyone speaks ${req.language}, and so do you. The student's level is ${req.level} on the CEFR scale, so everything you say must suit that level.

${levelRules(req)}
Scene: ${req.scene}

Rules for your turn:
- Write ONLY the words you say out loud in this turn: one or two short sentences. No name label, no stage directions, no markdown, no emojis, no lists.
- Talk like a real person in a group: react to what was just said, build on it, agree or disagree lightly, joke, or ask someone a question by name. Do not repeat or summarise what others said.
- Speak only for yourself, never for anyone else. Do not say you are an AI.
- Include the student: sometimes ask them a simple question, and always respond to what the student said if they spoke last.
- Listen like a person does. If the student says several things in a row, or comes back to something they said earlier, connect them: answer the whole of it together and show you remember the earlier part (for example "You said you like football, and now you say you play on Sundays, so..."). Do not answer only the last sentence.${req.studentName ? `\n- Call the student by their name, ${req.studentName}, now and then, naturally, for example when you speak to them directly. Not in every line.` : ""}
- When you speak to one person, use their name so everyone knows who you mean.
- Take turns like people do: say your line once the last speaker has finished, and answer what was actually said to you. If a question was put to someone else, leave it to them instead of answering for them, unless they have already answered or you are naturally joining in.
- If the student makes a real mistake, say the correct form naturally, in passing, instead of lecturing. Do not correct more than one thing.
- Keep to the scene, but let the conversation flow naturally.`;
}

/** How many lines the student said in a row at the end of the transcript, with nobody answering in between. */
export function trailingStudentLines(transcript: Line[]): number {
  let n = 0;
  for (let i = transcript.length - 1; i >= 0 && transcript[i].speaker === "user"; i--) n++;
  return n;
}

/** The turn itself: the script so far and what to do now. */
export function speakerContents(req: RoundRequest, id: string, direction: string): string {
  const me = CHARACTER_PROFILES[id].name;
  const history = req.transcript.length
    ? `The conversation so far:\n${script(req.transcript.slice(-SPEAKER_CONTEXT), req.studentName)}\n\n`
    : "The conversation is just starting.\n\n";
  const several = trailingStudentLines(req.transcript);
  const together =
    several > 1
      ? `The student has just said ${several} things in a row (the last ${several} lines above). Treat them as one connected message: answer all of it together and link the parts, for example how the later part follows from or changes the earlier one.\n`
      : "";
  const note = `${together}${direction ? `Private note for this turn: ${direction}\n` : ""}`;
  return `${history}${note}It is your turn, ${me}. Say your line now.`;
}

/** Strips a "Name:" label or surrounding quotes the model sometimes adds. */
export function cleanLine(text: string, id: string): string {
  let out = text.trim();
  const name = CHARACTER_PROFILES[id]?.name;
  if (name) out = out.replace(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*`, "i"), "");
  return out.replace(/^["“”]+|["“”]+$/g, "").replace(/[*_#`]/g, "").trim();
}

/** Instructions for the conductor that decides who speaks next. */
export function conductorInstruction(req: RoundRequest): string {
  return `You direct a natural, flowing group conversation in ${req.language} between a language learner (the student) and these characters:
${roster(req.participants)}

Scene: ${req.scene}

Decide who speaks next. Reply with JSON: {"next": "<character id or user>", "to": "<who they will talk to>", "direction": "<a private note, at most 15 words>"}.
The character ids are: ${req.participants.join(", ")}. Use "user" to hand the floor to the student. "to" is a character id, "user" (the student) or "all" (the whole table). People mostly answer whoever spoke just before them, so "to" is usually that person.

Rules:
- If the student spoke last, someone must respond now. Choose whoever is best placed: a person addressed by name, or the group's teacher. If the student said several things in a row, the direction should tell them to answer everything together.
- If the last line asks the student a question, or invites them to speak, choose "user".
- Otherwise let the characters talk to each other for two or three lines so it feels like a real group, then hand over to the student.
- A question put to one person is answered by that person, so choose them. Do not let someone else answer it for them, and do not let two people go on talking about the same point at once.
- Never choose the same character twice in a row. Give everyone a turn over time.
- Prefer a character who has something natural to add. Someone who was just addressed should answer.
- The direction tells the next speaker what to do, for example "answer Luna, then ask the student about weekends".`;
}

export function conductorContents(req: RoundRequest): string {
  const history = req.transcript.length ? script(req.transcript.slice(-CONDUCTOR_CONTEXT), req.studentName) : "(nobody has spoken yet)";
  let sinceStudent = 0;
  for (let i = req.transcript.length - 1; i >= 0 && req.transcript[i].speaker !== "user"; i--) sinceStudent++;
  return `The conversation so far:\n${history}\n\nLines spoken by the characters since the student last spoke: ${sinceStudent}.\nWho speaks next?`;
}
