// Measures how quickly each Google Cloud region answers from this computer, to pick GOOGLE_CLOUD_LOCATION
// for Vertex AI. Run it with: `npm run probe:regions`
//
// It sends a small request that is refused for lack of credentials. The refusal comes from the regional
// service itself, so the time it takes is the real distance to that region, with no key, project or billing needed.
// The first request on each connection is thrown away, so only the request itself is timed, not the handshake.

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

async function time(url: string): Promise<number> {
  const start = performance.now();
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
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

const targets: [string, string][] = [
  ...REGIONS.map((r): [string, string] => [r, `https://${r}-aiplatform.googleapis.com/v1/projects/probe/locations/${r}/publishers/google/models/gemini-3.5-flash-lite`]),
  ["global (Vertex)", "https://aiplatform.googleapis.com/v1/projects/probe/locations/global/publishers/google/models/gemini-3.5-flash-lite"],
  ["Gemini API (API key, no region)", "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite"],
];

const results: Result[] = [];
for (const [label, url] of targets) results.push(await probe(label, url));
results.sort((a, b) => a.ms - b.ms);

console.log("Round-trip time to each endpoint from here (median of " + SAMPLES + ", lower is better):\n");
for (const r of results) console.log(`${r.label.padEnd(34)} ${Number.isFinite(r.ms) ? `${r.ms.toFixed(0).padStart(5)} ms   (best ${r.min.toFixed(0)} ms)` : `failed: ${r.error}`}`);
const best = results.find((r) => /^[a-z]+-[a-z]+\d+$/.test(r.label) && Number.isFinite(r.ms));
if (best) console.log(`\nClosest region: ${best.label}\nUse it with:  GOOGLE_GENAI_USE_VERTEXAI=true  GOOGLE_CLOUD_LOCATION=${best.label}  GOOGLE_CLOUD_PROJECT=<your project>`);
