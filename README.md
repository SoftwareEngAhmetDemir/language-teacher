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
