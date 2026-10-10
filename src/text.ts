import type { Chat } from "@google/genai";
import { getClient } from "./client.js";
import { TEXT_MODEL, thinkingConfig } from "./models.js";
import { buildSystemInstruction, type Profile } from "./teacher.js";

const IDLE_MS = 10 * 60_000;

interface Entry {
  key: string;
  chat: Chat;
  queue: Promise<unknown>;
  lastUsed: number;
}

const chats = new Map<string, Entry>();

setInterval(() => {
  const cutoff = Date.now() - IDLE_MS;
  for (const [id, e] of chats) if (e.lastUsed < cutoff) chats.delete(id);
}, 60_000).unref();

/** One chat per session; changing language or level starts a fresh conversation. */
function getEntry(id: string, profile: Profile): Entry {
  let entry = chats.get(id);
  if (!entry || entry.key !== profile.key) {
    entry = {
      key: profile.key,
      chat: getClient().chats.create({
        model: TEXT_MODEL,
        config: {
          systemInstruction: buildSystemInstruction(profile),
          ...thinkingConfig,
        },
      }),
      queue: Promise.resolve(),
      lastUsed: Date.now(),
    };
    chats.set(id, entry);
  }
  return entry;
}

/** Stream a reply to `prompt`, keeping conversation history per session id. */
export function textSend(
  id: string,
  profile: Profile,
  prompt: string,
  onDelta: (text: string) => void,
): Promise<void> {
  const entry = getEntry(id, profile);
  entry.lastUsed = Date.now();
  const run = async () => {
    const stream = await entry.chat.sendMessageStream({ message: prompt });
    for await (const chunk of stream) if (chunk.text) onDelta(chunk.text);
  };
  const result = entry.queue.then(run, run);
  entry.queue = result.catch(() => {});
  return result;
}
