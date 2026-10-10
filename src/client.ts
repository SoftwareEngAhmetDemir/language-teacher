import { GoogleGenAI } from "@google/genai";

/**
 * The Vertex AI region used when none is chosen. Measured from Turkey (`npm run probe:regions`), Milan answers
 * soonest, then Frankfurt and the Netherlands; the Gemini API with a plain key has no region at all and was
 * about twice as slow to answer. All of them offer the Gemini 3.x text, Live and speech models.
 */
export const DEFAULT_VERTEX_LOCATION = "europe-west8";

type Env = Record<string, string | undefined>;

export type ClientSettings = { vertexai: true; project: string; location: string } | { vertexai: false; apiKey: string };

/**
 * Gemini Developer API by default (GEMINI_API_KEY): one global endpoint, no region to choose.
 * Set GOOGLE_GENAI_USE_VERTEXAI=true to use Vertex AI instead, where requests go to a region close to you:
 * GOOGLE_CLOUD_LOCATION (default europe-west8, Milan), your project in GOOGLE_CLOUD_PROJECT, and sign-in
 * through Application Default Credentials (`gcloud auth application-default login`).
 */
export function clientSettings(env: Env = process.env): ClientSettings {
  if (env.GOOGLE_GENAI_USE_VERTEXAI === "true") {
    if (!env.GOOGLE_CLOUD_PROJECT) throw new Error("Vertex mode needs GOOGLE_CLOUD_PROJECT");
    return { vertexai: true, project: env.GOOGLE_CLOUD_PROJECT, location: env.GOOGLE_CLOUD_LOCATION || DEFAULT_VERTEX_LOCATION };
  }
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");
  return { vertexai: false, apiKey: env.GEMINI_API_KEY };
}

let client: GoogleGenAI | undefined;

export function getClient(): GoogleGenAI {
  if (client) return client;
  const settings = clientSettings();
  if (settings.vertexai) {
    console.log(`Gemini: Vertex AI, region ${settings.location}`);
    return (client = new GoogleGenAI(settings));
  }
  console.log("Gemini: Developer API (no region; Vertex AI in a nearby region is faster, see docs/regions.md)");
  return (client = new GoogleGenAI({ apiKey: settings.apiKey }));
}
