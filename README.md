# Language Teacher

Practise a language by talking to an AI teacher. Pick a language and a CEFR level (A1 to C2+), then either hold a natural voice conversation, where you can interrupt the teacher at any time, or chat by text with browser voices. Built on the Gemini API: the Live API for voice and a Flash model for text.

- `src/` — Node/Express service (TypeScript): the teacher prompt, text chat over server-sent events, and a WebSocket relay to the Gemini Live API.
- `web/` — React + TypeScript frontend (Vite).

## Run locally

Needs Node 22.12 or newer and a [Gemini API key](https://aistudio.google.com/apikey).

```bash
cp .env.example .env        # then put your GEMINI_API_KEY in .env
npm install
npm run dev                 # backend on http://localhost:3000

cd web && npm install && npm run dev   # frontend, open the URL it prints
```

## Deploy

The Dockerfile builds the frontend and serves everything from one Node process. The app needs a host that supports WebSockets and long-lived connections, so static or serverless hosts such as Vercel and Netlify will not work.

On [Render](https://render.com): New → Blueprint → pick this repo. Set `GEMINI_API_KEY` and `ACCESS_CODE` when asked. Render's free plan sleeps when idle, so the first request after a pause is slow.

**Set `ACCESS_CODE` on any public deployment.** Without it anyone with the URL can use your Gemini quota. When it is set, the app asks for the code before it works.

## Configuration

See [.env.example](.env.example) for all options (models, thinking level, voice, Vertex AI region, call limit).

## The 3D teacher

The teacher is a [VRM](https://vrm.dev) character rendered with [three.js](https://threejs.org) and [@pixiv/three-vrm](https://github.com/pixiv/three-vrm) (all MIT). Her mouth follows the audio being played: each frame the app measures the voice's formants (linear prediction) to pick the vowel shape, and its loudness to set how far the jaw opens. She also blinks, breathes, keeps eye contact and nods with the voice. In text mode, where the browser's voice can't be analysed, the mouth uses a syllable-paced animation instead.

The model is `web/public/models/teacher.vrm`, the sample avatar from the three-vrm repository by pixiv Inc. (VRM license: redistribution and modification allowed, no credit required). To use another character, replace that file with any VRM 0.x or 1.0 model that has the `aa`, `ih`, `ou`, `ee` and `oh` expressions, and check its license first.
