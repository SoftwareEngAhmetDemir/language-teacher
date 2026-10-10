export interface Language {
  name: string;
  speechTag: string;
}

export interface Config {
  languages: Language[];
  levels: string[];
  requiresCode: boolean;
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
