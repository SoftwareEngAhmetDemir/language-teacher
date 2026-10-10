import { Type } from "@google/genai";
import { CHARACTER_PROFILES } from "../characters.js";
import { getClient } from "../client.js";
import { TEXT_MODEL, thinkingConfig } from "../models.js";
import { cleanLine, conductorContents, conductorInstruction, speakerContents, speakerInstruction } from "./prompts.js";
import type { Decision, RoundRequest } from "./types.js";

/**
 * The two things the conversation graph needs from a language model. The graph depends only on this
 * interface, so models can be swapped per character and tests can use a scripted fake.
 */
export interface GroupLLM {
  /** Suggests who speaks next. Returns null when it has no usable answer, so the rules take over. */
  decide(req: RoundRequest, signal?: AbortSignal): Promise<Decision | null>;
  /** Writes one character's line, streaming it through `onDelta`, and returns the finished line. */
  speak(req: RoundRequest, id: string, direction: string, onDelta: (text: string) => void, signal?: AbortSignal): Promise<string>;
}

const CONDUCTOR_MODEL = process.env.GEMINI_CONDUCTOR_MODEL ?? TEXT_MODEL;
/** A conductor that is slow is not worth waiting for: after this the rules choose the speaker. */
const CONDUCTOR_TIMEOUT_MS = Number(process.env.GROUP_CONDUCTOR_TIMEOUT_MS ?? 2500);

export const geminiGroupLLM: GroupLLM = {
  async decide(req, signal) {
    // Stop waiting for the model after the timeout, or sooner if the student interrupts.
    const patience = signal ? AbortSignal.any([signal, AbortSignal.timeout(CONDUCTOR_TIMEOUT_MS)]) : AbortSignal.timeout(CONDUCTOR_TIMEOUT_MS);
    try {
      const response = await getClient().models.generateContent({
        model: CONDUCTOR_MODEL,
        contents: conductorContents(req),
        config: {
          systemInstruction: conductorInstruction(req),
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              next: { type: Type.STRING, enum: [...req.participants, "user"] },
              to: { type: Type.STRING, enum: [...req.participants, "user", "all"] },
              direction: { type: Type.STRING },
            },
            required: ["next", "to", "direction"],
          },
          temperature: 0.8,
          abortSignal: patience,
          ...thinkingConfig,
        },
      });
      const parsed = JSON.parse(response.text ?? "") as Partial<Decision>;
      if (typeof parsed.next !== "string") return null;
      return {
        next: parsed.next,
        direction: typeof parsed.direction === "string" ? parsed.direction : "",
        to: typeof parsed.to === "string" && parsed.to !== "all" ? parsed.to : undefined,
      };
    } catch (err) {
      if (signal?.aborted) throw err;
      console.error("Conductor failed, using rules instead:", err instanceof Error ? err.message : err);
      return null;
    }
  },

  async speak(req, id, direction, onDelta, signal) {
    const stream = await getClient().models.generateContentStream({
      model: CHARACTER_PROFILES[id].model ?? TEXT_MODEL,
      contents: speakerContents(req, id, direction),
      config: {
        systemInstruction: speakerInstruction(req, id),
        temperature: 1,
        maxOutputTokens: 200,
        abortSignal: signal,
        ...thinkingConfig,
      },
    });
    let text = "";
    for await (const chunk of stream) {
      if (chunk.text) {
        text += chunk.text;
        onDelta(chunk.text);
      }
    }
    return cleanLine(text, id);
  },
};
