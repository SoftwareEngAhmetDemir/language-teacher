import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clientSettings, DEFAULT_VERTEX_LOCATION } from "./client.js";

describe("clientSettings", () => {
  it("uses the Developer API with a key by default, which has no region", () => {
    assert.deepEqual(clientSettings({ GEMINI_API_KEY: "k" }), { vertexai: false, apiKey: "k" });
  });

  it("explains what is missing", () => {
    assert.throws(() => clientSettings({}), /GEMINI_API_KEY is not set/);
    assert.throws(() => clientSettings({ GOOGLE_GENAI_USE_VERTEXAI: "true" }), /GOOGLE_CLOUD_PROJECT/);
  });

  it("uses Vertex AI at the global endpoint, where the 3.x models are served, unless a location is chosen", () => {
    const base = { GOOGLE_GENAI_USE_VERTEXAI: "true", GOOGLE_CLOUD_PROJECT: "my-project" };
    assert.deepEqual(clientSettings(base), { vertexai: true, project: "my-project", location: DEFAULT_VERTEX_LOCATION });
    assert.equal(DEFAULT_VERTEX_LOCATION, "global");
    assert.equal((clientSettings({ ...base, GOOGLE_CLOUD_LOCATION: "europe-west4" }) as { location: string }).location, "europe-west4");
    assert.equal((clientSettings({ ...base, GOOGLE_CLOUD_LOCATION: "" }) as { location: string }).location, DEFAULT_VERTEX_LOCATION, "an empty value means the default");
  });
});
