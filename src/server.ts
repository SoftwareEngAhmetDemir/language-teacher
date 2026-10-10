import express from "express";
import { existsSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { fileURLToPath } from "node:url";
import { codeOk, requiresCode } from "./access.js";
import { LANGUAGES, LEVELS, parseProfile } from "./teacher.js";
import { textSend } from "./text.js";
import { voiceServer } from "./voice.js";

const app = express();
app.use(express.json({ limit: "32kb" }));

// Serve the built React app (web/dist) if it exists. In development use `npm run dev` in web/.
const webDist = fileURLToPath(new URL("../web/dist", import.meta.url));
if (existsSync(webDist)) app.use(express.static(webDist));

const isSessionId = (v: unknown): v is string => typeof v === "string" && /^[\w-]{8,64}$/.test(v);

/** Languages and levels the UI can offer, and whether it must ask for an access code. */
app.get("/api/config", (_req, res) => {
  res.json({ languages: LANGUAGES, levels: LEVELS, requiresCode });
});

/** Lets the UI check an access code before showing the app. */
app.post("/api/access", (req, res) => {
  if (codeOk(req.body?.code)) res.json({ ok: true });
  else res.status(401).json({ error: "Wrong access code" });
});

/** Streams the teacher's reply as server-sent events: {delta}, then {done} or {error}. */
app.post("/api/chat", async (req, res) => {
  if (!codeOk(req.get("x-access-code"))) {
    res.status(401).json({ error: "Access code required" });
    return;
  }
  const { sessionId, message, language, level } = req.body ?? {};
  const profile = parseProfile(language, level);
  if (!isSessionId(sessionId)) {
    res.status(400).json({ error: "`sessionId` is invalid" });
    return;
  }
  if (!profile) {
    res.status(400).json({ error: `\`language\` must be one of the supported languages and \`level\` one of ${LEVELS.join(", ")}` });
    return;
  }
  if (typeof message !== "string" || !message.trim() || message.length > 8000) {
    res.status(400).json({ error: "`message` must be a non-empty string (max 8000 chars)" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.socket?.setNoDelay(true);
  const send = (event: object) => {
    if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    await textSend(sessionId, profile, message, (delta) => send({ delta }));
    send({ done: true });
  } catch (err) {
    console.error(err);
    send({ error: err instanceof Error ? err.message : "Gemini request failed" });
  } finally {
    res.end();
  }
});

/** Browsers always send Origin on WebSocket upgrades; refuse other sites so they can't spend the API key. */
function isSameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

const port = Number(process.env.PORT ?? 3000);
const server = app.listen(port, () => console.log(`http://localhost:${port}`));

server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url ?? "", "http://localhost");
  if (pathname !== "/api/live" || !isSameOrigin(req)) {
    socket.destroy();
    return;
  }
  voiceServer.handleUpgrade(req, socket, head, (ws) => voiceServer.emit("connection", ws, req));
});
