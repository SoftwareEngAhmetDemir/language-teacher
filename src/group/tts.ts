import { Modality, type GoogleGenAI } from "@google/genai";
import { CHARACTER_PROFILES, type CharacterProfile } from "../characters.js";
import { getClient } from "../client.js";

export const TTS_SAMPLE_RATE = 24000;

/**
 * Speech models to try, fastest first: the lite model starts talking soonest. Setting GEMINI_TTS_MODEL
 * uses only that one, for example the full-quality `gemini-3.8-flash-tts`.
 */
const DEFAULT_MODELS = ["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts", "gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts"];

/** Finds the PCM samples in a WAV file, or returns the bytes unchanged when there is no WAV header. */
export function pcmFromWav(bytes: Buffer): Buffer {
  if (bytes.length < 12 || bytes.toString("ascii", 0, 4) !== "RIFF") return bytes;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (id === "data") return bytes.subarray(offset + 8, size ? Math.min(bytes.length, offset + 8 + size) : bytes.length);
    offset += 8 + size + (size % 2);
  }
  return bytes;
}

/** A one-line description of an SDK error, including the HTTP status and body when there are any. */
export function describeError(err: unknown): string {
  const e = err as { message?: string; statusCode?: number; status?: number; body?: unknown; cause?: { message?: string } } | null;
  const parts = [e?.message ?? String(err)];
  const status = e?.statusCode ?? e?.status;
  if (status) parts.push(`status ${status}`);
  if (typeof e?.body === "string" && e.body) parts.push(e.body.slice(0, 300));
  else if (e?.cause?.message && e.cause.message !== e.message) parts.push(e.cause.message);
  return parts.join(" · ");
}

const statusOf = (err: unknown): number | undefined => {
  const e = err as { statusCode?: number; status?: number } | null;
  return e?.statusCode ?? e?.status;
};

/** Whether the error means "too many requests right now", which is worth waiting out. */
export function isRateLimited(err: unknown): boolean {
  return statusOf(err) === 429 || /\b429\b|RESOURCE_EXHAUSTED|rate limit|quota/i.test((err as { message?: string } | null)?.message ?? "");
}

/** Whether the model itself doesn't exist or isn't offered to this account, so no other call will work with it. */
function isMissingModel(err: unknown): boolean {
  return statusOf(err) === 404 || /model .*not found|not found.*model|is not supported for|not available/i.test((err as { message?: string } | null)?.message ?? "");
}

type Api = "stream" | "interactions" | "classic";
interface Candidate {
  model: string;
  api: Api;
}
const keyOf = (c: Candidate) => `${c.model}/${c.api}`;

const interactionBody = (model: string, text: string, profile: CharacterProfile) => ({
  model,
  input: [{ type: "user_input" as const, content: [{ type: "text" as const, text, annotations: [{ type: "speech_metadata" as const, style: profile.ttsStyle }] }] }],
  response_format: { type: "audio" as const, mime_type: "audio/l16", sample_rate: TTS_SAMPLE_RATE },
  generation_config: { speech_config: [{ voice: profile.voice }] },
});

/**
 * Audio as it is generated, so the first sound arrives long before the whole line is ready. Automatic
 * retries are off: the SDK's own retry can fail while re-sending the request and hide the real error.
 */
async function* viaStream(ai: GoogleGenAI, model: string, text: string, profile: CharacterProfile): AsyncGenerator<Buffer> {
  const stream = await ai.interactions.create({ ...interactionBody(model, text, profile), stream: true }, { retries: { strategy: "none" } });
  let first = true;
  for await (const event of stream) {
    if (event.event_type !== "step.delta" || event.delta.type !== "audio" || !event.delta.data) continue;
    let chunk: Buffer = Buffer.from(event.delta.data, "base64");
    if (first) (chunk = pcmFromWav(chunk)), (first = false);
    if (chunk.length) yield chunk;
  }
}

/** The documented single-response call: the whole line at once. */
async function* viaInteractions(ai: GoogleGenAI, model: string, text: string, profile: CharacterProfile): AsyncGenerator<Buffer> {
  const interaction = await ai.interactions.create(interactionBody(model, text, profile), { retries: { strategy: "none" } });
  const data = interaction.output_audio?.data;
  if (data) yield pcmFromWav(Buffer.from(data, "base64"));
}

/** The classic text-to-speech call, used by models that don't take the Interactions API. */
async function* viaGenerateContent(ai: GoogleGenAI, model: string, text: string, profile: CharacterProfile): AsyncGenerator<Buffer> {
  const response = await ai.models.generateContent({
    model,
    contents: [{ parts: [{ text: `Say in a ${profile.ttsStyle} way: ${text}` }] }],
    config: { responseModalities: [Modality.AUDIO], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: profile.voice } } } },
  });
  const data = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
  if (data) yield pcmFromWav(Buffer.from(data, "base64"));
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface EngineOptions {
  models?: string[];
  /** How many lines are spoken at once. Speech models have small request limits, so this stays low. */
  concurrency?: number;
  /** Waits before retrying a rate-limited request; replaceable in tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** How long to stop trying after every option has failed, so lines fall back to the browser voice at once. */
  coolDownMs?: number;
}

/**
 * Turns lines into speech in each character's own natural Gemini voice, quickly and robustly:
 * - audio is streamed as it is generated, so a line starts playing after its first chunk, not after the last;
 * - it tries each speech model with the streaming call, the single-response call and the classic call,
 *   remembers what worked, and never retries a model that doesn't exist;
 * - it waits out a rate limit once (speech models allow few requests per minute) and keeps few requests at a time;
 * - after everything has failed it stops trying for a short while, so the browser voice takes over without a delay.
 */
export class SpeechEngine {
  private working: Candidate | null = null;
  private deadModels = new Set<string>();
  private deadCandidates = new Set<string>();
  private brokenUntil = 0;
  private lastError = "";
  private active = 0;
  private waiting: (() => void)[] = [];
  private readonly candidates: Candidate[];
  private readonly concurrency: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly coolDownMs: number;

  constructor(
    private ai: () => GoogleGenAI,
    options: EngineOptions = {},
  ) {
    const models = options.models ?? DEFAULT_MODELS;
    this.candidates = models.flatMap((model) => (["stream", "interactions", "classic"] as const).map((api) => ({ model, api })));
    this.concurrency = options.concurrency ?? 2;
    this.sleep = options.sleep ?? delay;
    this.now = options.now ?? Date.now;
    this.coolDownMs = options.coolDownMs ?? 30_000;
  }

  /** Yields the line's raw 16-bit mono PCM (24 kHz) in pieces, as they are generated. */
  async *stream(text: string, character: string): AsyncGenerator<Buffer> {
    if (this.now() < this.brokenUntil) throw new Error(this.lastError);
    await this.acquire();
    try {
      yield* this.attempt(text, CHARACTER_PROFILES[character]);
    } finally {
      this.release();
    }
  }

  /** The whole line at once. */
  async synthesize(text: string, character: string): Promise<Buffer> {
    const parts: Buffer[] = [];
    for await (const chunk of this.stream(text, character)) parts.push(chunk);
    return Buffer.concat(parts);
  }

  private async *attempt(text: string, profile: CharacterProfile): AsyncGenerator<Buffer> {
    const ai = this.ai();
    const order = this.working ? [this.working, ...this.candidates.filter((c) => c !== this.working)] : this.candidates;
    const failures: string[] = [];
    let waited = false;
    for (const candidate of order) {
      if (this.deadModels.has(candidate.model) || this.deadCandidates.has(keyOf(candidate))) continue;
      for (;;) {
        let yielded = false;
        try {
          const call = candidate.api === "stream" ? viaStream : candidate.api === "interactions" ? viaInteractions : viaGenerateContent;
          for await (const chunk of call(ai, candidate.model, text, profile)) {
            if (!yielded) this.working = candidate;
            yielded = true;
            yield chunk;
          }
          if (!yielded) throw new Error("The speech model returned no audio");
          return;
        } catch (err) {
          // Once sound has started it can't be taken back: the line just ends early.
          if (yielded) {
            console.warn("Speech was cut short:", describeError(err));
            return;
          }
          // Too many requests: wait once, then carry on with the same option; no more waiting after that.
          if (isRateLimited(err) && !waited) {
            waited = true;
            await this.sleep(1500);
            continue;
          }
          failures.push(`${candidate.model} (${candidate.api}): ${describeError(err)}`);
          if (isMissingModel(err)) this.deadModels.add(candidate.model);
          else if (statusOf(err) === 400) this.deadCandidates.add(keyOf(candidate));
          break;
        }
      }
    }
    this.lastError = `Natural voice unavailable. ${failures.join(" | ")}`;
    this.brokenUntil = this.now() + this.coolDownMs;
    throw new Error(this.lastError);
  }

  private acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiting.push(() => (this.active++, resolve())));
  }

  private release(): void {
    this.active--;
    this.waiting.shift()?.();
  }
}

const configured = process.env.GEMINI_TTS_MODEL;
const engine = new SpeechEngine(getClient, {
  models: configured ? [configured] : DEFAULT_MODELS,
  concurrency: Number(process.env.GROUP_TTS_CONCURRENCY ?? 3),
});

/** Speaks `text` in a character's own voice, yielding raw 16-bit mono PCM at 24 kHz as it is generated. */
export const speakStream = (text: string, character: string): AsyncGenerator<Buffer> => engine.stream(text, character);
