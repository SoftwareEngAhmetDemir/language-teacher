import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import express from "express";
import type { GroupLLM } from "./llm.js";
import type { GroupEvent } from "./types.js";

// The access code is read when the module loads, so set it before importing the routes.
process.env.ACCESS_CODE = "open-sesame";
const { registerGroupRoutes } = await import("./routes.js");

let aborted = 0;
const llm: GroupLLM = {
  async decide(req) {
    const last = req.transcript[req.transcript.length - 1];
    return { next: last?.speaker === "luna" ? "rex" : "luna", direction: "" };
  },
  async speak(_req, id, _direction, onDelta, signal) {
    for (const word of ["Merhaba", "arkadaşlar!"]) {
      if (signal?.aborted) {
        aborted++;
        throw new Error("aborted");
      }
      onDelta(word + " ");
      await new Promise((r) => setTimeout(r, 15));
    }
    return `${id} says: Merhaba arkadaşlar!`;
  },
};

let server: Server;
let base = "";
const headers = { "Content-Type": "application/json", "x-access-code": "open-sesame" };
const body = { language: "Turkish", level: "A1", participants: ["luna", "rex"], transcript: [{ speaker: "user", text: "Merhaba" }], scene: "cafe" };

before(async () => {
  const app = express();
  app.use(express.json());
  registerGroupRoutes(app, {
    llm,
    speak: async function* (text) {
      if (text === "fail") throw new Error("no voice today");
      yield Buffer.from(new Int16Array([1, 2]).buffer);
      await new Promise((resolve) => setTimeout(resolve, 30));
      yield Buffer.from(new Int16Array([3]).buffer);
    },
  });
  server = app.listen(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

async function events(res: Response): Promise<GroupEvent[]> {
  const text = await res.text();
  return text.split("\n\n").filter(Boolean).map((chunk) => JSON.parse(chunk.replace(/^data: /, "")));
}

describe("POST /api/group/round", () => {
  it("streams the turns and says whose turn it is next", async () => {
    const res = await fetch(`${base}/api/group/round`, { method: "POST", headers, body: JSON.stringify(body) });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
    const all = await events(res);
    const speakers = all.filter((e) => e.type === "end").map((e) => (e as { speaker: string }).speaker);
    assert.deepEqual(speakers.slice(0, 2), ["luna", "rex"]);
    assert.equal(all[all.length - 1].type, "done");
  });

  it("refuses requests without the access code", async () => {
    const res = await fetch(`${base}/api/group/round`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(res.status, 401);
  });

  it("rejects an invalid table before streaming anything", async () => {
    const res = await fetch(`${base}/api/group/round`, { method: "POST", headers, body: JSON.stringify({ ...body, participants: ["luna"] }) });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /participants/);
  });

  it("stops generating when the student interrupts (the browser drops the connection)", async () => {
    const before = aborted;
    const controller = new AbortController();
    const res = await fetch(`${base}/api/group/round`, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
    const reader = res.body!.getReader();
    await reader.read(); // the first event has arrived
    controller.abort();
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(aborted > before, "the model call was cancelled");
  });
});

describe("POST /api/speak", () => {
  it("returns raw audio for a known character", async () => {
    const res = await fetch(`${base}/api/speak`, { method: "POST", headers, body: JSON.stringify({ text: "Merhaba", character: "luna" }) });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-sample-rate"), "24000");
    assert.equal((await res.arrayBuffer()).byteLength, 6);
  });

  it("sends the first audio before the rest has been generated", async () => {
    const res = await fetch(`${base}/api/speak`, { method: "POST", headers, body: JSON.stringify({ text: "Merhaba", character: "luna" }) });
    const reader = res.body!.getReader();
    const first = await reader.read();
    assert.equal(first.value?.byteLength, 4, "the first chunk arrives on its own");
    const rest = await reader.read();
    assert.equal(rest.value?.byteLength, 2);
    assert.equal((await reader.read()).done, true);
  });

  it("reports a voice that can't be produced as an error the browser can act on", async () => {
    const res = await fetch(`${base}/api/speak`, { method: "POST", headers, body: JSON.stringify({ text: "fail", character: "luna" }) });
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /no voice today/);
  });

  it("rejects unknown characters, empty and oversized text, and a missing code", async () => {
    const post = (payload: unknown, h: Record<string, string> = headers) => fetch(`${base}/api/speak`, { method: "POST", headers: h, body: JSON.stringify(payload) });
    assert.equal((await post({ text: "hi", character: "hacker" })).status, 400);
    assert.equal((await post({ text: "  ", character: "luna" })).status, 400);
    assert.equal((await post({ text: "x".repeat(601), character: "luna" })).status, 400);
    assert.equal((await post({ text: "hi", character: "luna" }, { "Content-Type": "application/json" })).status, 401);
  });
});
