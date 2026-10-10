# Choosing a region for the Gemini calls

Where the Gemini requests go changes how soon each answer starts. The Gemini API with a plain API key (`GEMINI_API_KEY`) has **no region**: every request goes to one global endpoint. **Vertex AI** lets you pick a Google Cloud region near you, and the app can use it with three environment variables.

## What was measured from Turkey

`npm run probe:regions` times a small request to each regional endpoint from your own computer (no key, project or billing needed; the refusal comes from the regional service, so the time is the real distance). Median of 9, in milliseconds, lower is better:

| Endpoint | Time |
|---|---|
| **europe-west8** (Milan) | **72** |
| europe-west3 (Frankfurt) | 80 |
| europe-west4 (Netherlands) | 85 |
| europe-west9 (Paris) | 92 |
| europe-west1 (Belgium) | 93 |
| europe-central2 (Warsaw) | 104 |
| europe-southwest1 (Madrid) | 106 |
| europe-north1 (Finland) | 111 |
| me-west1 (Tel Aviv) | 126 |
| Gemini API with a key (no region) | 156 |
| me-central2 (Dammam) | 161 |
| global endpoint on Vertex AI | 188 |
| me-central1 (Doha) | 191 |
| us-central1 (Iowa) | 199 |

Milan is closest, then Frankfurt and the Netherlands. The Middle East regions are further than they look on a map, and the global endpoint is slower than the nearby European ones. Your network matters, so run the probe yourself; the numbers move a little from run to run.

Google lists the same models in its Europe and Middle East regions, including Gemini 3.8 Flash, 3.5 Flash-Lite, 3.8 Live and the 3.8 text-to-speech models (the speech ones are in preview).

A group conversation makes several requests in a row (who speaks next, the line, its voice), so the saving of roughly 80 ms per request adds up to a few tenths of a second per line, and it matters most for the live voice, which keeps a connection open.

## Turning it on

1. In Google Cloud, create or pick a project with billing, and enable the **Vertex AI API**.
2. Sign in on your computer: `gcloud auth application-default login`
3. In `.env`:

```
GOOGLE_GENAI_USE_VERTEXAI=true
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_CLOUD_LOCATION=europe-west8
```

`GOOGLE_CLOUD_LOCATION` can be left out: the default is europe-west8. Restart the server; its first log line says which one is in use (`Gemini: Vertex AI, region europe-west8` or `Gemini: Developer API`). You no longer need `GEMINI_API_KEY`.

## Things to know

- **Billing.** Vertex AI is billed to the project. Its request limits are usually higher than a free API key's, which also helps the speech models, which allow few requests per minute on a free key.
- **Speech.** The Interactions API may not be offered on Vertex AI; the speech engine then falls back automatically to the classic streaming call, which keeps the audio streaming.
- **Model names** on Vertex AI can differ or be missing in a region. If a model isn't found there, the log names it; set `GEMINI_TEXT_MODEL`, `GEMINI_TTS_MODEL` or `GEMINI_LIVE_MODEL` to one that is, or try another region (europe-west3 or europe-west4).
- **Where deployed**, pick the region near the server, not near you: a server in Frankfurt should use europe-west3.
