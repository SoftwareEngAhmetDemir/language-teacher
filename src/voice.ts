import { Modality, type LiveServerMessage, type Session } from "@google/genai";
import { WebSocketServer, type WebSocket } from "ws";
import { codeOk } from "./access.js";
import { voiceFor } from "./characters.js";
import { getClient } from "./client.js";
import { buildSystemInstruction, parseProfile } from "./teacher.js";

const MODEL = process.env.GEMINI_LIVE_MODEL ?? "gemini-3.8-live";
const MAX_CALLS = Number(process.env.MAX_VOICE_CALLS ?? 5);
const START_TIMEOUT_MS = 10_000;

let activeCalls = 0;

/**
 * Full-duplex voice conversation, relayed between the browser and the Gemini Live API.
 *
 * Browser -> server: a JSON `{type:"start", language, level}` first, then binary frames of
 * 16 kHz 16-bit mono PCM microphone audio (and optionally `{type:"text", text}`).
 * Server -> browser: binary frames of 24 kHz 16-bit mono PCM teacher audio, plus JSON events:
 * ready, input_transcript, output_transcript, interrupted, turn_complete, error.
 *
 * Gemini detects when the student starts talking over the teacher and reports it as
 * `interrupted`, so the browser can drop the audio it still has queued.
 */
export const voiceServer = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

voiceServer.on("connection", (ws: WebSocket) => {
  let session: Session | undefined;
  let starting = false;
  let counted = false;
  let closed = false;

  const send = (event: object) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
  };
  const fail = (message: string) => {
    send({ type: "error", message });
    ws.close();
  };
  const startTimer = setTimeout(() => ws.close(1008, "start message expected"), START_TIMEOUT_MS);

  const onGeminiMessage = (message: LiveServerMessage) => {
    const content = message.serverContent;
    if (!content) return;
    for (const part of content.modelTurn?.parts ?? []) {
      if (part.inlineData?.data && ws.readyState === ws.OPEN) ws.send(Buffer.from(part.inlineData.data, "base64"));
    }
    if (content.inputTranscription?.text) send({ type: "input_transcript", text: content.inputTranscription.text });
    if (content.outputTranscription?.text) send({ type: "output_transcript", text: content.outputTranscription.text });
    if (content.interrupted) send({ type: "interrupted" });
    if (content.turnComplete) send({ type: "turn_complete" });
  };

  async function start(language: unknown, level: unknown, character: unknown, studentName: unknown, code: unknown) {
    if (!codeOk(code)) return fail("Access code required");
    const profile = parseProfile(language, level, character, studentName);
    if (!profile) return fail("Unsupported language or level");
    if (activeCalls >= MAX_CALLS) return fail("Too many active conversations, try again shortly");
    activeCalls++;
    counted = true;
    // Each character has its own voice, set when the call starts.
    const voice = voiceFor(profile.character);

    try {
      const live = await getClient().live.connect({
        model: MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: buildSystemInstruction(profile),
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          // Lets a call run past the default 15-minute audio session limit.
          contextWindowCompression: { slidingWindow: {} },
          ...(voice && { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } }),
        },
        callbacks: {
          onopen: () => {},
          onmessage: onGeminiMessage,
          onerror: (e) => fail(e.message ?? "Live API error"),
          onclose: (e) => {
            if (!closed) fail(`The conversation ended${e.reason ? `: ${e.reason}` : ""}`);
          },
        },
      });
      if (closed) return live.close();
      session = live;
      send({ type: "ready" });
      // Have the teacher speak first.
      live.sendRealtimeInput({ text: "Hello! Please start our lesson." });
    } catch (err) {
      console.error(err);
      fail(err instanceof Error ? err.message : "Could not start the conversation");
    }
  }

  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      session?.sendRealtimeInput({ audio: { data: (data as Buffer).toString("base64"), mimeType: "audio/pcm;rate=16000" } });
      return;
    }
    let msg: { type?: string; language?: unknown; level?: unknown; character?: unknown; studentName?: unknown; code?: unknown; text?: unknown };
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.type === "start" && !starting) {
      starting = true;
      clearTimeout(startTimer);
      void start(msg.language, msg.level, msg.character, msg.studentName, msg.code);
    } else if (msg.type === "text" && typeof msg.text === "string" && msg.text.trim()) {
      session?.sendRealtimeInput({ text: msg.text.slice(0, 2000) });
    }
  });

  ws.on("close", () => {
    closed = true;
    clearTimeout(startTimer);
    session?.close();
    if (counted) activeCalls--;
  });
  ws.on("error", () => ws.close());
});
