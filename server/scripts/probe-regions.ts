// Helps pick GOOGLE_CLOUD_LOCATION for Vertex AI. Run it with: `npm run probe:regions`
//
// 1. Distance: times a small request to each regional endpoint (no key, project or billing needed). The refusal
//    comes from the regional service itself, so the time is the real distance to that region.
// 2. Availability: if GOOGLE_CLOUD_PROJECT is set and you are signed in with `gcloud auth application-default
//    login`, it also asks each location to answer one tiny request with your model, because a region that is
//    close is no use if it doesn't serve the model. The best choice is the fastest location that does.
//
// Options: --model <id> (default: GEMINI_TEXT_MODEL, else gemini-3.5-flash-lite)

import { execSync } from "node:child_process";

const REGIONS = [
  "europe-west1", // Belgium
  "europe-west3", // Frankfurt
  "europe-west4", // Netherlands
  "europe-west8", // Milan
  "europe-west9", // Paris
  "europe-central2", // Warsaw
  "europe-southwest1", // Madrid
  "europe-north1", // Finland
  "me-west1", // Tel Aviv
  "me-central1", // Doha
  "me-central2", // Dammam
  "us-central1", // Iowa (for comparison)
];
const SAMPLES = 9;

interface Result {
  label: string;
  ms: number;
  min: number;
  error?: string;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const hostFor = (location: string) => (location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`);

async function time(url: string, init?: RequestInit): Promise<number> {
  const start = performance.now();
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  await res.arrayBuffer();
  return performance.now() - start;
}

async function probe(label: string, url: string): Promise<Result> {
  try {
    await time(url); // opens the connection; not counted
    const samples: number[] = [];
    for (let i = 0; i < SAMPLES; i++) samples.push(await time(url));
    return { label, ms: median(samples), min: Math.min(...samples) };
  } catch (err) {
    return { label, ms: Infinity, min: Infinity, error: err instanceof Error ? err.message : String(err) };
  }
}

async function distances(): Promise<Result[]> {
  const targets: [string, string][] = [
    ...REGIONS.map((r): [string, string] => [r, `https://${hostFor(r)}/v1/projects/probe/locations/${r}/publishers/google/models/gemini-3.5-flash-lite`]),
    ["global (Vertex)", "https://aiplatform.googleapis.com/v1/projects/probe/locations/global/publishers/google/models/gemini-3.5-flash-lite"],
    ["Gemini API (API key, no region)", "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite"],
  ];
  const results: Result[] = [];
  for (const [label, url] of targets) results.push(await probe(label, url));
  return results.sort((a, b) => a.ms - b.ms);
}

function accessToken(): string | null {
  try {
    return execSync("gcloud auth application-default print-access-token", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

/** Which locations answer a one-word request with the model, and how fast (median of 3 on a warm connection). */
async function availability(project: string, model: string, token: string): Promise<{ location: string; ms: number }[]> {
  const body = JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Reply with the single word OK." }] }], generationConfig: { maxOutputTokens: 8, temperature: 0 } });
  const serving: { location: string; ms: number }[] = [];
  for (const location of ["global", ...REGIONS]) {
    const url = `https://${hostFor(location)}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
    const init = { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body };
    try {
      const first = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
      await first.arrayBuffer();
      if (first.status !== 200) {
        console.log(`  ${location.padEnd(18)} not available (HTTP ${first.status})`);
        continue;
      }
      const times: number[] = [];
      for (let i = 0; i < 3; i++) times.push(await time(url, init));
      const ms = median(times);
      serving.push({ location, ms });
      console.log(`  ${location.padEnd(18)} serves it, ${ms.toFixed(0)} ms per request`);
    } catch (err) {
      console.log(`  ${location.padEnd(18)} failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  return serving.sort((a, b) => a.ms - b.ms);
}

const argument = (name: string) => process.argv[process.argv.indexOf(name) + 1];
const model = (process.argv.includes("--model") && argument("--model")) || process.env.GEMINI_TEXT_MODEL || "gemini-3.5-flash-lite";

const results = await distances();
console.log(`Round-trip time to each endpoint from here (median of ${SAMPLES}, lower is better):\n`);
for (const r of results) console.log(`${r.label.padEnd(34)} ${Number.isFinite(r.ms) ? `${r.ms.toFixed(0).padStart(5)} ms   (best ${r.min.toFixed(0)} ms)` : `failed: ${r.error}`}`);
const nearest = results.find((r) => /^[a-z]+-[a-z]+\d+$/.test(r.label) && Number.isFinite(r.ms));
if (nearest) console.log(`\nNearest region by distance: ${nearest.label}`);

const project = process.env.GOOGLE_CLOUD_PROJECT;
const token = project ? accessToken() : null;
if (!project || !token) {
  console.log(`\nTo see which locations serve ${model} for your project, set GOOGLE_CLOUD_PROJECT and run \`gcloud auth application-default login\`, then run this again.`);
} else {
  console.log(`\nWhich locations serve ${model} for project ${project}:\n`);
  const serving = await availability(project, model, token);
  if (serving[0]) {
    console.log(`\nBest location for ${model}: ${serving[0].location}`);
    console.log(`Use it with:  GOOGLE_GENAI_USE_VERTEXAI=true  GOOGLE_CLOUD_PROJECT=${project}  GOOGLE_CLOUD_LOCATION=${serving[0].location}`);
  } else {
    console.log(`\nNo location answered with ${model}. Check the model name, the Vertex AI API and billing for the project.`);
  }
}
