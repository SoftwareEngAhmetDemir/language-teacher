import { GoogleGenAI } from "@google/genai";

let client: GoogleGenAI | undefined;

/**
 * Gemini Developer API by default (GEMINI_API_KEY, single global endpoint).
 * Set GOOGLE_GENAI_USE_VERTEXAI=true to use Vertex AI instead, which lets you
 * pick a region via GOOGLE_CLOUD_LOCATION (project from GOOGLE_CLOUD_PROJECT,
 * auth via Application Default Credentials).
 */
export function getClient(): GoogleGenAI {
  if (client) return client;
  if (process.env.GOOGLE_GENAI_USE_VERTEXAI === "true") {
    const { GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_LOCATION } = process.env;
    if (!GOOGLE_CLOUD_PROJECT || !GOOGLE_CLOUD_LOCATION) {
      throw new Error("Vertex mode needs GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION");
    }
    return (client = new GoogleGenAI({
      vertexai: true,
      project: GOOGLE_CLOUD_PROJECT,
      location: GOOGLE_CLOUD_LOCATION,
    }));
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  return (client = new GoogleGenAI({ apiKey }));
}
