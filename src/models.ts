import { ThinkingLevel } from "@google/genai";

// Fastest stable text model per Google's model list.
export const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL ?? "gemini-3.5-flash-lite";

// Minimal thinking = lowest latency. Set THINKING_LEVEL=off to not send the setting.
const THINKING = process.env.THINKING_LEVEL ?? "MINIMAL";
export const thinkingConfig =
  THINKING !== "off" ? { thinkingConfig: { thinkingLevel: THINKING as ThinkingLevel } } : {};
