# Choosing where the Gemini calls go

The Gemini API with a plain API key (`GEMINI_API_KEY`) has **no region**: every request goes to one global endpoint. **Vertex AI** lets you choose a location, and the app uses it when three environment variables are set. The best choice is not simply the nearest region.

## What was found from Turkey

`npm run probe:regions` checks two things from your own computer.

**1. How far each region is** (median of 9 requests, lower is better):

| Endpoint | Time |
|---|---|
| europe-west8 (Milan) | 72 ms |
| europe-west3 (Frankfurt) | 80 ms |
| europe-west4 (Netherlands) | 85 ms |
| europe-west9 (Paris), europe-west1 (Belgium) | about 90 ms |
| europe-central2 (Warsaw) | 104 ms |
| me-west1 (Tel Aviv) | 126 ms |
| global endpoint | 170 to 190 ms |
| us-central1 (Iowa) | 199 ms |

**2. Which locations serve your model.** This decides it. For the project tested, the Gemini 3.x models (text `gemini-3.5-flash-lite`, `gemini-3.8-flash`, `gemini-3.6-flash`) were served **only at the `global` location**. Every region asked (all of Europe, the Middle East, the US, Asia) answered "not found" for them, and only had the older Gemini 2.5 models. The 3.8 Live and 3.8 speech models also worked at `global`.

So the best location for this app is **`global`**, which is the default. Google routes it to nearby capacity; a tiny request takes about half a second, most of it model time. If you used a nearby region you would have to use the older 2.5 models, which can be faster per request (the Netherlands answered a one-word request in about 150 ms with `gemini-2.5-flash-lite`) but are weaker at keeping to a language level, and are being phased out.

If a regional location starts serving the 3.x models for your project, `npm run probe:regions` will show it. Run it with `GOOGLE_CLOUD_PROJECT` set and `gcloud auth application-default login` done, and it lists which locations answer with your model and how fast, and names the best one. Use `--model <id>` to check another model.

## Turning it on

1. In Google Cloud, use a project with billing and the **Vertex AI API** enabled.
2. Sign in on your computer: `gcloud auth application-default login`
3. In `.env`:

```
GOOGLE_GENAI_USE_VERTEXAI=true
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_CLOUD_LOCATION=global
```

`GOOGLE_CLOUD_LOCATION` can be left out: the default is `global`. Restart the server; its first log line says what is in use (`Gemini: Vertex AI, region global` or `Gemini: Developer API`). You no longer need `GEMINI_API_KEY`.

## Things to know

- **Billing.** Vertex AI is billed to the project. Its request limits are usually higher than a free API key's, which also helps the speech models.
- **Speech.** Vertex AI doesn't offer the Interactions API, so speech uses the classic streaming call, which keeps the audio streaming. The 3.x speech models read the text word for word, so the line is sent without a style instruction; the 2.5 speech models get "Say in a gentle way: ..." in front, which they treat as an instruction.
- **Live voice.** `gemini-3.8-live` connects on Vertex AI at `global`. In some projects it is only served elsewhere (for example `us-central1`); set `GEMINI_LIVE_LOCATION` to send voice calls there while text and speech stay at `global`.
- **Model names** can differ or be missing in a location. If one isn't found, the log names it; set `GEMINI_TEXT_MODEL`, `GEMINI_TTS_MODEL` or `GEMINI_LIVE_MODEL`.
- **A key that has run out of credit** (HTTP 402 "prepayment credits are depleted") makes every call fail; Vertex AI uses the project's billing instead.
- **Where deployed**, the same applies: check with the probe from the server, not from your laptop.
