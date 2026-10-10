export interface Language {
  name: string;
  speechTag: string;
}

export interface Config {
  languages: Language[];
  levels: string[];
  requiresCode: boolean;
  group: GroupOptions;
}

const CODE_KEY = "accessCode";

/** The access code the user entered, kept for this browser tab only. */
export function getCode(): string {
  try {
    return sessionStorage.getItem(CODE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Checks a code with the server and remembers it if it is right. */
export async function unlock(code: string): Promise<boolean> {
  const res = await fetch("/api/access", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) return false;
  try {
    sessionStorage.setItem(CODE_KEY, code);
  } catch {
    // Without storage the code has to be entered again after a reload.
  }
  return true;
}

export interface Lesson {
  sessionId: string;
  language: string;
  level: string;
  /** Id of the teacher character, which decides the personality and the voice. */
  character: string;
  /** What the characters should call the student. */
  studentName?: string;
}

export async function fetchConfig(): Promise<Config> {
  const res = await fetch("/api/config");
  if (!res.ok) throw new Error(`Could not load config (${res.status})`);
  return res.json();
}

/** Sends a message and yields the teacher's reply in pieces as they arrive. */
export async function* streamReply(
  lesson: Lesson,
  message: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-access-code": getCode() },
    body: JSON.stringify({ ...lesson, message }),
    signal,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? res.statusText);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, end).replace(/^data: /, "");
      buf = buf.slice(end + 2);
      const event = JSON.parse(raw) as { delta?: string; done?: boolean; error?: string };
      if (event.error) throw new Error(event.error);
      if (event.delta) yield event.delta;
    }
  }
}

/** Translates a piece of transcript text into one of the supported languages. */
export async function translate(text: string, target: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-access-code": getCode() },
    body: JSON.stringify({ text, target }),
    signal,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body.translation as string;
}

/** Events the server streams while a group-conversation round runs. */
export type GroupEvent =
  | { type: "start"; speaker: string }
  | { type: "delta"; speaker: string; text: string }
  /** `addressee` is who the line was said to: a character id, "user" for the student, or nothing for the whole table. */
  | { type: "end"; speaker: string; text: string; addressee?: string }
  | { type: "done"; awaitUser: boolean }
  | { type: "error"; message: string };

export interface GroupRoundRequest {
  language: string;
  level: string;
  participants: string[];
  /** The conversation as the student has seen and heard it; speakers are character ids or "user". */
  transcript: { speaker: string; text: string }[];
  /** A scene id from the config, or the student's own topic. */
  scene: string;
  studentName?: string;
}

/** Runs one round of group conversation and yields its events as they arrive. */
export async function* streamGroupRound(request: GroupRoundRequest, signal?: AbortSignal): AsyncGenerator<GroupEvent> {
  const res = await fetch("/api/group/round", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-access-code": getCode() },
    body: JSON.stringify(request),
    signal,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? res.statusText);
  }
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, end).replace(/^data: /, "");
      buf = buf.slice(end + 2);
      yield JSON.parse(raw) as GroupEvent;
    }
  }
}

/**
 * Asks for one line spoken in a character's voice. The response body is raw 16-bit mono PCM at 24 kHz and
 * arrives as it is generated, so it can be played before it is complete.
 */
export async function openSpeech(text: string, character: string, signal?: AbortSignal): Promise<Response> {
  const res = await fetch("/api/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-access-code": getCode() },
    body: JSON.stringify({ text, character }),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? res.statusText);
  }
  return res;
}

export interface GroupOptions {
  min: number;
  max: number;
  characters: { id: string; name: string; role: string }[];
  scenes: { id: string; title: string }[];
}
