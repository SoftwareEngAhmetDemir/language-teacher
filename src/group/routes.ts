import type { Express } from "express";
import { codeOk } from "../access.js";
import { isCharacterId } from "../characters.js";
import { runRound } from "./graph.js";
import { geminiGroupLLM, type GroupLLM } from "./llm.js";
import { designScene, geminiDesign, type DesignModel } from "./sceneStyle.js";
import { describeError, speakStream, TTS_SAMPLE_RATE } from "./tts.js";
import type { GroupEvent } from "./types.js";
import { parseRound } from "./validate.js";

const MAX_TURNS_PER_ROUND = Number(process.env.GROUP_MAX_TURNS ?? 4);
const MAX_ROUNDS_AT_ONCE = Number(process.env.GROUP_MAX_ROUNDS ?? 6);
const MAX_SPEECH_AT_ONCE = Number(process.env.GROUP_MAX_SPEECH ?? 8);
const MAX_SPEECH_CHARS = 600;
const MAX_TOPIC_CHARS = 120;
/** The first line of a round is picked by rules, not by a model call, so the group starts talking sooner. */
const FAST_START = process.env.GROUP_FAST_START !== "false";
/** Set GROUP_LOG_TIMING=1 to log how long each round and each voice takes to start. */
const LOG_TIMING = Boolean(process.env.GROUP_LOG_TIMING);

let activeRounds = 0;
let activeSpeech = 0;

/** The model calls behind the routes, replaceable in tests. */
export interface GroupDeps {
  llm: GroupLLM;
  /** Speaks a line, yielding raw PCM audio as it is generated. */
  speak: (text: string, character: string) => AsyncIterable<Buffer>;
  /** Chooses the room's colours and props for a topic. */
  design?: DesignModel;
}

const defaultDeps: GroupDeps = { llm: geminiGroupLLM, speak: speakStream };

export function registerGroupRoutes(app: Express, deps: GroupDeps = defaultDeps): void {
  /** Streams one round of group conversation as server-sent events (see GroupEvent). */
  app.post("/api/group/round", async (req, res) => {
    if (!codeOk(req.get("x-access-code"))) {
      res.status(401).json({ error: "Access code required" });
      return;
    }
    const parsed = parseRound(req.body, MAX_TURNS_PER_ROUND);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    if (activeRounds >= MAX_ROUNDS_AT_ONCE) {
      res.status(429).json({ error: "The group is busy, try again in a moment" });
      return;
    }

    activeRounds++;
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.socket?.setNoDelay(true);
    const send = (event: GroupEvent) => {
      if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // If the student interrupts, the browser drops the connection: stop generating right away.
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) controller.abort();
    });

    const started = Date.now();
    let lines = 0;
    const emit = (event: GroupEvent) => {
      if (LOG_TIMING && event.type === "end") console.log(`[round] line ${++lines} (${event.speaker}) finished after ${Date.now() - started} ms`);
      send(event);
    };

    try {
      const { awaitUser } = await runRound(parsed.value, { llm: deps.llm, emit, signal: controller.signal, fastStart: FAST_START });
      if (LOG_TIMING) console.log(`[round] done: ${lines} lines in ${Date.now() - started} ms`);
      send({ type: "done", awaitUser });
    } catch (err) {
      if (!controller.signal.aborted) {
        console.error(err);
        send({ type: "error", message: err instanceof Error ? err.message : "The group conversation failed" });
      }
    } finally {
      activeRounds--;
      res.end();
    }
  });

  /** Designs the 3D room for the student's own topic: colours, props and the view from the window. */
  app.post("/api/group/scene-style", async (req, res) => {
    if (!codeOk(req.get("x-access-code"))) {
      res.status(401).json({ error: "Access code required" });
      return;
    }
    const topic = typeof req.body?.topic === "string" ? req.body.topic.replace(/\s+/g, " ").trim().slice(0, MAX_TOPIC_CHARS) : "";
    if (!topic) {
      res.status(400).json({ error: "`topic` must be a non-empty string" });
      return;
    }
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) controller.abort();
    });
    try {
      res.json(await designScene(topic, deps.design ?? geminiDesign, controller.signal));
    } catch {
      if (!res.headersSent) res.status(499).end();
    }
  });

  /** Speaks one line in a character's voice. Responds with raw 16-bit mono PCM (24 kHz). */
  app.post("/api/speak", async (req, res) => {
    if (!codeOk(req.get("x-access-code"))) {
      res.status(401).json({ error: "Access code required" });
      return;
    }
    const { text, character } = req.body ?? {};
    if (!isCharacterId(character)) {
      res.status(400).json({ error: "`character` is not a known character" });
      return;
    }
    if (typeof text !== "string" || !text.trim() || text.length > MAX_SPEECH_CHARS) {
      res.status(400).json({ error: `\`text\` must be a non-empty string (max ${MAX_SPEECH_CHARS} chars)` });
      return;
    }
    if (activeSpeech >= MAX_SPEECH_AT_ONCE) {
      res.status(429).json({ error: "Too many voices at once" });
      return;
    }
    activeSpeech++;
    const started = Date.now();
    const audio = deps.speak(text.trim(), character)[Symbol.asyncIterator]();
    // If the browser goes away (the student interrupted), stop reading the audio.
    res.on("close", () => {
      if (!res.writableFinished) void audio.return?.();
    });
    try {
      let sent = false;
      for (let next = await audio.next(); !next.done; next = await audio.next()) {
        // The first chunk starts the response, so a failure before it can still be reported as an error.
        if (!sent) {
          sent = true;
          if (LOG_TIMING) console.log(`[speak] ${character}: first audio after ${Date.now() - started} ms`);
          res.writeHead(200, { "Content-Type": "application/octet-stream", "X-Sample-Rate": String(TTS_SAMPLE_RATE), "Cache-Control": "no-store" });
          res.socket?.setNoDelay(true);
        }
        res.write(next.value);
      }
      if (!sent) throw new Error("The speech model returned no audio");
      res.end();
    } catch (err) {
      // One readable line; the browser falls back to its own voice for this line.
      console.warn("Speech failed:", describeError(err));
      if (!res.headersSent) res.status(502).json({ error: err instanceof Error ? err.message : "Speech failed" });
      else res.end();
    } finally {
      activeSpeech--;
    }
  });
}
