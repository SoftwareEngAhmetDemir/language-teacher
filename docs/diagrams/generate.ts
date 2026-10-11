// Draws the architecture diagrams in this folder as SVG files: `npm run diagrams`.
// The PNG copies were rendered from the SVGs in a browser.
import { writeFileSync } from "node:fs";

const OUT = new URL(".", import.meta.url).pathname;
const C = { blue: "#1a73e8", green: "#2e9e5b", purple: "#8e44ad", orange: "#d98324", red: "#c62828", ink: "#1b2430", grey: "#5b6675", line: "#3b4656" };
const FILL = { blue: "#eaf2fe", green: "#e9f6ee", purple: "#f4ebfa", orange: "#fdf1e0", red: "#fdecec", white: "#ffffff" };

/** A colour from the palette that can fill a card, zone or circle. */
type Tone = "blue" | "green" | "purple" | "orange" | "red";
interface TextOptions { size?: number; weight?: number; fill?: string; anchor?: "start" | "middle" | "end"; halo?: boolean; italic?: boolean }
interface RectOptions { fill?: string; stroke?: string; sw?: number; rx?: number; dash?: string }
interface ArrowOptions { color?: string; dash?: string; sw?: number }
interface MessageOptions { dash?: boolean; color?: string; sub?: string }

const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const text = (x: number, y: number, s: string, { size = 15, weight = 400, fill = C.ink, anchor = "start", halo = false, italic = false }: TextOptions = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${italic ? ' font-style="italic"' : ""}${halo ? ' stroke="#fff" stroke-width="5" paint-order="stroke" stroke-linejoin="round"' : ""}>${esc(s)}</text>`;
const lines = (x: number, y: number, arr: string[], opts: TextOptions = {}) => arr.map((s, i) => text(x, y + i * (opts.size ?? 15) * 1.45, s, opts)).join("");
const rect = (x: number, y: number, w: number, h: number, { fill = "#fff", stroke = C.line, sw = 2, rx = 14, dash = "" }: RectOptions = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
const card = (x: number, y: number, w: number, h: number, color: Tone, title: string, body: string[] = [], { titleSize = 18 }: { titleSize?: number } = {}) =>
  rect(x, y, w, h, { fill: FILL[color], stroke: C[color] }) + text(x + 18, y + 30, title, { size: titleSize, weight: 700, fill: C[color] }) + lines(x + 18, y + 56, body, { size: 14.5, fill: C.ink });
const arrow = (d: string, { color = C.line, dash = "", sw = 2.4 }: ArrowOptions = {}) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ""} marker-end="url(#ah-${colorKey(color)})"/>`;
const colorKey = (c: string) => Object.entries(C).find(([, v]) => v === c)?.[0] ?? "line";
const markers = Object.entries(C).map(([k, v]) => `<marker id="ah-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="13" markerHeight="13" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${v}"/></marker>`).join("");

function svg(w: number, h: number, title: string, subtitle: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Inter, system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif">
<defs>${markers}</defs>
<rect width="${w}" height="${h}" fill="#ffffff"/>
${text(40, 52, title, { size: 28, weight: 800 })}
${text(40, 82, subtitle, { size: 15.5, fill: C.grey })}
${body}
</svg>`;
}
const zone = (x: number, y: number, w: number, h: number, color: Tone, label: string) => rect(x, y, w, h, { fill: FILL[color], stroke: C[color], sw: 2, rx: 20 }) + text(x + 20, y + 30, label, { size: 14, weight: 800, fill: C[color] });
const circle = (cx: number, cy: number, r: number, color: Tone, label: string) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C[color]}"/>` + text(cx, cy + 5, label, { size: 14, weight: 800, fill: "#fff", anchor: "middle" });

// ---------------------------------------------------------------- 1. overview
{
  let b = "";
  b += zone(30, 110, 440, 640, "green", "BROWSER   React + three.js");
  b += zone(640, 110, 360, 640, "blue", "SERVER   Node + Express");
  b += zone(1170, 110, 240, 640, "purple", "GEMINI API");

  b += card(50, 150, 400, 90, "green", "GroupChat (the screen)", ["Who sits at the table (2 to 4), scene,", "your name, typing and the microphone"]);
  b += card(50, 262, 400, 100, "green", "useGroupChat (round driver)", ["Asks the server for lines, lets you interrupt,", "carries on by itself, tracks who is speaking"]);
  b += card(50, 480, 400, 100, "green", "GroupPlayer (audio queue)", ["Fetches each line's voice, plays them in order,", "one audio analyser per character"]);
  b += card(50, 630, 400, 100, "green", "GroupScene (three.js)", ["Table, chairs, up to four seats. Lips follow", "each analyser; eyes follow who talks to whom"]);

  b += rect(660, 230, 320, 240, { fill: "#fff", stroke: C.blue });
  b += text(678, 260, "POST /api/group/round", { size: 18, weight: 700, fill: C.blue });
  b += text(678, 283, "validate → run the graph → stream events", { size: 13.5, fill: C.grey });
  b += rect(678, 300, 284, 152, { fill: FILL.blue, stroke: C.blue, dash: "6 5" });
  b += text(692, 321, "LangGraph", { size: 13, weight: 800, fill: C.blue });
  b += rect(694, 340, 108, 50, { fill: FILL.orange, stroke: C.orange }) + text(748, 371, "conductor", { size: 15, weight: 700, fill: C.orange, anchor: "middle" });
  b += rect(838, 340, 108, 50, { fill: FILL.blue, stroke: C.blue }) + text(892, 371, "speaker", { size: 15, weight: 700, fill: C.blue, anchor: "middle" });
  b += arrow("M802 365 L838 365");
  b += arrow("M892 390 C892 436 748 436 748 390", { color: C.grey, sw: 2 });
  b += text(820, 446, "loop", { size: 12.5, fill: C.grey, anchor: "middle" });
  b += card(660, 480, 320, 100, "blue", "POST /api/speak", ["SpeechEngine: tries speech models,", "waits out rate limits, 2 lines at a time"]);

  b += card(1185, 260, 210, 160, "purple", "Text models", ["Conductor:", "JSON next · to · direction", "Speaker:", "one line, streamed"]);
  b += card(1185, 480, 210, 100, "purple", "Speech models", ["each character's own", "voice → 24 kHz audio"]);

  const lab = (x: number, y: number, s: string, o: TextOptions = {}) => text(x, y, s, { size: 13, anchor: "middle", halo: true, weight: 600, ...o });
  b += arrow("M450 300 L660 300") + lab(555, 286, "round request") + lab(555, 322, "transcript · scene · name", { size: 11.5, weight: 400, fill: C.grey });
  b += arrow("M660 350 L450 350", { dash: "7 5", color: C.blue }) + lab(555, 340, "events: start · delta · end · done", { size: 11.5, weight: 400, fill: C.blue });
  b += arrow("M980 330 L1185 330") + lab(1082, 316, "decide · speak");
  b += arrow("M1185 372 L980 372", { dash: "7 5", color: C.purple }) + lab(1082, 392, "JSON · text", { size: 12, weight: 400, fill: C.purple });
  b += arrow("M250 362 L250 480") + lab(268, 424, "a finished line → queue it", { anchor: "start" });
  b += arrow("M450 520 L660 520") + lab(555, 506, "line + character");
  b += arrow("M660 556 L450 556", { dash: "7 5", color: C.blue }) + lab(555, 576, "PCM audio", { size: 12, weight: 400, fill: C.blue });
  b += arrow("M980 520 L1185 520") + lab(1082, 506, "speak");
  b += arrow("M1185 556 L980 556", { dash: "7 5", color: C.purple }) + lab(1082, 576, "audio", { size: 12, weight: 400, fill: C.purple });
  b += arrow("M250 580 L250 630") + lab(268, 610, "analysers", { anchor: "start" });
  b += text(660, 640, "The server keeps no state: the browser sends the", { size: 14, fill: C.grey, weight: 600 });
  b += text(660, 662, "transcript with every round.", { size: 14, fill: C.grey, weight: 600 });
  b += text(660, 696, "If the student interrupts, the browser drops the", { size: 14, fill: C.grey });
  b += text(660, 718, "connection and the server stops the graph and the", { size: 14, fill: C.grey });
  b += text(660, 740, "Gemini calls straight away.", { size: 14, fill: C.grey });
  writeFileSync(`${OUT}/1-overview.svg`, svg(1440, 790, "The big picture", "What runs where, and what travels between the pieces", b));
}

// ---------------------------------------------------------------- 2. the graph
{
  let b = "";
  b += circle(100, 290, 36, "green", "START");
  b += card(230, 215, 270, 150, "orange", "conductor", ["Asks Gemini who speaks next,", "then guard() makes the final call", "", "Output: next · to · direction"]);
  b += card(640, 215, 270, 150, "blue", "speaker", ["Writes that character's line and streams", "it. Works out who it was said to.", "", "Output: the line + the addressee"]);
  b += circle(1100, 290, 36, "red", "END");
  b += arrow("M136 290 L230 290");
  b += arrow("M500 290 L640 290") + text(570, 274, "next is a character", { size: 13.5, anchor: "middle", halo: true, weight: 600 });
  b += arrow("M775 365 C775 470 365 470 365 365", { color: C.blue }) + text(570, 456, "next line  (turn + 1)", { size: 14, anchor: "middle", halo: true, weight: 700, fill: C.blue });
  b += arrow("M365 215 C365 100 1100 100 1100 254", { color: C.red }) + text(735, 122, "next is the student, or the turn budget (4 lines) is used up", { size: 14, anchor: "middle", halo: true, weight: 700, fill: C.red });
  b += text(640, 168, "conditional edge", { size: 12.5, fill: C.grey, anchor: "middle", italic: true });

  b += rect(40, 520, 380, 200, { fill: FILL.orange, stroke: C.orange });
  b += text(58, 550, "conductor node", { size: 16, weight: 800, fill: C.orange });
  b += lines(58, 578, ["• the model proposes, the rules decide", "• someone always answers the student", "• nobody speaks twice in a row", "• the speaker must be at the table", "• no answer from the model? use rules"], { size: 14.5 });
  b += rect(450, 520, 380, 200, { fill: FILL.blue, stroke: C.blue });
  b += text(468, 550, "speaker node", { size: 16, weight: 800, fill: C.blue });
  b += lines(468, 578, ["• sends  start → delta … → end  to the browser", "• told who to talk to, and uses their name", "• detectAddressee(): who was it for?", "• adds the line to the transcript", "• an empty line is an error"], { size: 14.5 });
  b += rect(860, 520, 380, 200, { fill: "#f7f8fa", stroke: C.line });
  b += text(878, 550, "State carried around the loop", { size: 16, weight: 800 });
  b += lines(878, 578, ["req   language, level, participants,", "         scene, student name, transcript", "         (one more line each loop)", "turns   lines spoken this round", "decision   next · to · direction"], { size: 14.5 });
  b += text(650, 770, "After END:  awaitUser = the conductor handed over, or the budget ran out right after a question.", { size: 14.5, weight: 700, anchor: "middle", fill: C.ink });
  b += text(650, 794, "Per run, the graph is given:  the model interface (llm), a way to send events (emit), and an AbortSignal for interruptions.", { size: 13.5, anchor: "middle", fill: C.grey });
  writeFileSync(`${OUT}/2-langgraph.svg`, svg(1280, 820, "One round is a LangGraph loop", "A state graph: the conductor picks a speaker, the speaker talks, repeat until the floor goes to the student", b));
}

// ---------------------------------------------------------------- 3. the conductor
{
  let b = "";
  b += card(40, 140, 230, 150, "green", "1  What it knows", ["the transcript so far", "who is at the table + roles", "the scene · student's name", "lines spoken this round"]);
  b += card(320, 140, 250, 150, "purple", "2  Gemini conductor", ["asked for JSON:", "{ next, to, direction }", "next = who speaks", "to = who they talk to"]);
  b += card(620, 140, 300, 150, "orange", "3  guard()  the final say", ["checks the suggestion against", "the rules below, fixes or", "replaces it, and ends the", "round when the budget is gone"]);
  b += card(970, 140, 270, 150, "blue", "4  Decision", ["next · who speaks", "to · who they talk to", "direction · a private note", "yielded · conductor | budget"]);
  b += arrow("M270 215 L320 215") + arrow("M570 215 L620 215") + arrow("M920 215 L970 215");

  b += rect(620, 340, 300, 250, { fill: "#fff", stroke: C.orange });
  b += text(638, 370, "guard() rules", { size: 16, weight: 800, fill: C.orange });
  b += lines(638, 398, ["1  turn budget used  →  hand to the student", "2  the student, after at least one line  →  ok", "3  start of a round  →  someone must answer", "4  speaker not at the table  →  replace", "5  same person twice in a row  →  replace", "6  `to` is another person, or the student"], { size: 13.6 });
  b += arrow("M770 290 L770 340", { color: C.orange });

  b += rect(320, 340, 250, 250, { fill: FILL.red, stroke: C.red, dash: "7 5" });
  b += text(338, 370, "If the model fails", { size: 16, weight: 800, fill: C.red });
  b += text(338, 392, "or says something invalid", { size: 13.5, fill: C.grey });
  b += lines(338, 424, ["pickNext() by plain rules:", "", "1  whoever was named in", "    the last line", "2  the teacher, after the", "    student has spoken", "3  whoever spoke least", "    recently"], { size: 13.8 });
  b += arrow("M445 290 L445 340", { color: C.red, dash: "7 5" }) + text(458, 322, "error / nonsense", { size: 12.5, fill: C.red, halo: true });
  b += arrow("M570 465 L620 465", { color: C.red, dash: "7 5" });

  b += card(970, 340, 270, 125, "blue", "5  The speaker writes", ["told:  direction + “Speak to Rex.”", "so they use that person's name"]);
  b += arrow("M1105 290 L1105 340");
  b += card(970, 515, 270, 205, "blue", "6  detectAddressee()", ["who was the line for?", "1  a name said in the line", "2  else the conductor's  to", "3  else the previous speaker", "→ sent as  end { addressee }"]);
  b += arrow("M1105 465 L1105 515");
  b += card(620, 640, 300, 95, "green", "7  In the 3D table", ["speaker ⇄ addressee look at each other,", "everyone else follows the speaker"]);
  b += arrow("M970 640 C 950 640 940 660 920 670", { color: C.green });
  writeFileSync(`${OUT}/3-conductor.svg`, svg(1280, 770, "How the conductor chooses who speaks", "The model proposes; plain rules keep the conversation natural and safe, and work even if the model fails", b));
}

// ---------------------------------------------------------------- 4. sequence
{
  let b = "";
  const X = { s: 140, b: 470, v: 810, g: 1150 };
  const head = (x: number, label: string, color: Tone) => rect(x - 90, 100, 180, 46, { fill: FILL[color], stroke: C[color] }) + text(x, 130, label, { size: 16, weight: 800, fill: C[color], anchor: "middle" });
  b += head(X.s, "Student", "green") + head(X.b, "Browser", "green") + head(X.v, "Server  (LangGraph)", "blue") + head(X.g, "Gemini", "purple");
  for (const x of Object.values(X)) b += `<line x1="${x}" y1="146" x2="${x}" y2="980" stroke="#c4cbd6" stroke-width="2" stroke-dasharray="5 6"/>`;
  const msg = (from: keyof typeof X, to: keyof typeof X, y: number, label: string, { dash = false, color = C.line, sub = "" }: MessageOptions = {}) => {
    const x1 = X[from], x2 = X[to], dir = x2 > x1 ? 1 : -1;
    return arrow(`M${x1 + 4 * dir} ${y} L${x2 - 4 * dir} ${y}`, { dash: dash ? "7 5" : "", color }) + text((x1 + x2) / 2, y - 9, label, { size: 13.5, anchor: "middle", halo: true, weight: 600, fill: color === C.line ? C.ink : color }) + (sub ? text((x1 + x2) / 2, y + 17, sub, { size: 12, anchor: "middle", halo: true, fill: C.grey }) : "");
  };
  const note = (x: number, y: number, w: number, h: number, color: Tone, arr: string[]) => rect(x, y, w, h, { fill: FILL[color], stroke: C[color], sw: 1.8, rx: 10 }) + lines(x + 14, y + 24, arr, { size: 13.2 });
  const num = (n: number, x: number, y: number) => `<circle cx="${x}" cy="${y}" r="13" fill="${C.ink}"/>` + text(x, y + 5, String(n), { size: 13, weight: 800, fill: "#fff", anchor: "middle" });

  b += msg("s", "b", 190, "types, or speaks into the microphone"); b += num(1, 56, 190);
  b += note(330, 212, 290, 50, "green", ["interrupt(): stop the audio, cancel any", "request still running"]);
  b += msg("b", "v", 300, "POST /api/group/round", { sub: "transcript · scene · participants · name" }); b += num(2, 396, 300);
  b += msg("v", "g", 365, "conductor: who speaks next?", { sub: "JSON schema: next · to · direction" }); b += num(3, 748, 365);
  b += msg("g", "v", 420, "{ next: luna, to: user }", { dash: true, color: C.purple });
  b += note(650, 436, 300, 48, "orange", ["guard() checks the suggestion", "(or pickNext() if the model failed)"]);
  b += msg("v", "g", 530, "speaker: write Luna's line (streamed)"); b += num(4, 748, 530);
  b += msg("g", "v", 580, "words …", { dash: true, color: C.purple });
  b += msg("v", "b", 640, "SSE  start · delta … · end { addressee }"); b += num(5, 396, 640);
  b += msg("b", "v", 705, "POST /api/speak  (Luna's line)"); b += num(6, 396, 705);
  b += msg("v", "g", 750, "speech model, Luna's voice");
  b += msg("g", "v", 795, "audio", { dash: true, color: C.purple });
  b += msg("v", "b", 840, "PCM audio", { dash: true, color: C.blue });
  b += note(330, 862, 340, 76, "green", ["7  play the line: lips follow Luna's analyser,", "     others look at her, the text appears", "     (and her name tag lights up)"]);
  b += note(700, 862, 480, 76, "blue", ["While line 1 is spoken, the server is already writing line 2", "(the conductor runs again).  At most 4 lines per round."]);
  b += msg("v", "b", 972, "SSE  done { awaitUser }", { sub: "" }); b += num(8, 396, 972);
  b += rect(40, 1002, 1200, 70, { fill: FILL.red, stroke: C.red, sw: 1.8, rx: 10 }) + lines(58, 1026, ["Interrupt at any moment: the browser drops the connection  →  the server's AbortSignal stops the graph and the Gemini calls  →  lines not yet heard are thrown away.", "When the round is done: if the floor is the student's, the screen says “Your turn”; otherwise the browser starts another round on its own (up to 2 more)."], { size: 13.2 });
  writeFileSync(`${OUT}/4-sequence.svg`, svg(1280, 1095, "One round, step by step", "From something you say to a character speaking", b));
}

// ---------------------------------------------------------------- 5. states
{
  let b = "";
  const node = (x: number, y: number, w: number, h: number, color: Tone, title: string, sub: string) => rect(x, y, w, h, { fill: FILL[color], stroke: C[color], sw: 2.6, rx: 22 }) + text(x + w / 2, y + 42, title, { size: 22, weight: 800, fill: C[color], anchor: "middle" }) + text(x + w / 2, y + 68, sub, { size: 13.5, fill: C.grey, anchor: "middle" });
  b += node(70, 250, 220, 100, "green", "idle", "nothing started yet");
  b += node(500, 250, 240, 100, "blue", "running", "lines written + spoken");
  b += node(950, 250, 220, 100, "orange", "waiting", "the floor is yours");
  b += arrow("M290 300 L500 300") + text(395, 280, "Start scene,", { size: 13.5, anchor: "middle", halo: true, weight: 600 }) + text(395, 322, "or you say something", { size: 13.5, anchor: "middle", halo: true, weight: 600 });
  b += arrow("M740 300 L950 300") + text(845, 276, "round over and it is", { size: 13.5, anchor: "middle", halo: true, weight: 600 }) + text(845, 294, "your turn  ·  or Stop", { size: 13.5, anchor: "middle", halo: true, weight: 600 });
  b += arrow("M1060 350 C1060 470 620 470 620 350") + text(840, 482, "you speak or type  ·  Keep talking", { size: 14, anchor: "middle", halo: true, weight: 700 });
  b += arrow("M560 250 C520 130 720 130 680 250", { color: C.blue }) + text(620, 120, "auto-continue: the round ended with no question for you,", { size: 13.5, anchor: "middle", halo: true, weight: 600, fill: C.blue }) + text(620, 139, "so the group carries on (up to 2 rounds in a row)", { size: 13.5, anchor: "middle", halo: true, weight: 600, fill: C.blue });
  b += arrow("M560 350 C540 520 180 520 180 350", { color: C.red }) + text(370, 524, "language, level, your name or who is at the table changes  →  start over", { size: 13.5, anchor: "middle", halo: true, weight: 700, fill: C.red });
  b += rect(40, 590, 1120, 110, { fill: "#f7f8fa", stroke: C.line, sw: 1.6, rx: 12 });
  b += lines(60, 618, ["running  =  the server is still writing lines  OR  the browser is still speaking them.  It ends when both are finished.", "Interrupting (typing, saying something, or Stop) cancels the request, stops the audio and drops lines nobody has heard yet.", "These states live in the browser (useGroupChat).  The server has no memory between rounds."], { size: 14 });
  writeFileSync(`${OUT}/5-states.svg`, svg(1240, 730, "The conversation's states in the browser", "How the screen decides when the group talks and when it is your turn", b));
}
console.log("written");
