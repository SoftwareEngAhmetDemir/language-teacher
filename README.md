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

## Group conversation

Pick **Group conversation** as the engine to seat two to five of the characters around a 3D table. They talk with you and with each other, a conductor (built with [LangGraph](https://langchain-ai.github.io/langgraphjs/)) decides who speaks next, and everyone speaks in their own voice. You can jump in at any moment by typing, pressing Stop or using the microphone. See [docs/group-chat.md](docs/group-chat.md) for how it works, the API and the limits. Run the tests with `npm test`.

## Each teacher has their own voice

In voice calls every character speaks with a different Gemini voice and personality: Professor Whiskers is calm and wise (Sadaltager), Ms. Luna warm and gentle (Sulafat), Coach Rex energetic (Fenrir), Robo-Tutor clear and even (Iapetus) and the anime teacher bright and breezy (Aoede). The voice and the personality text are chosen on the server from the character id (`src/characters.ts`), and the call has to be restarted to change them, so switching teacher starts a new conversation. Google does not label voices as male or female, so these are matched to its style descriptions; change them in that file if one doesn't suit. In text chat the browser's own voice is used, with a different pitch and pace per character (`web/src/avatar/characters.ts`).

## Translating the transcript

Every message in the transcript has a **Translate** button. It opens a language picker and shows the translation underneath, with a Copy button. Translations are cached per message, so switching languages back and forth is instant, and the last language you picked is remembered. The server does the translation through the same text model as the chat (`POST /api/translate`, limited to the supported languages and 2,000 characters), and it also asks for the access code when one is set.

## Deploy

The Dockerfile builds the frontend and serves everything from one Node process. The app needs a host that supports WebSockets and long-lived connections, so static or serverless hosts such as Vercel and Netlify will not work.

On [Render](https://render.com): New → Blueprint → pick this repo. Set `GEMINI_API_KEY` and `ACCESS_CODE` when asked. Render's free plan sleeps when idle, so the first request after a pause is slow.

**Set `ACCESS_CODE` on any public deployment.** Without it anyone with the URL can use your Gemini quota. When it is set, the app asks for the code before it works.

## Choosing a region

With a plain `GEMINI_API_KEY` the requests go to one global endpoint with no region choice. Vertex AI lets you choose a location. From Turkey the nearest regions (Milan, Frankfurt, the Netherlands) only serve the older Gemini 2.5 models, so the app uses the `global` location, where the 3.x models, Live and speech are available. See [docs/regions.md](docs/regions.md), and run `npm run probe:regions` to check your own connection and project.

## Configuration

See [.env.example](.env.example) for all options (models, thinking level, voice, Vertex AI region, call limit).

## The 3D teachers

Pick a teacher in the settings. All of them are rendered with [three.js](https://threejs.org) (MIT) and move their mouths with the audio being played: each frame the app measures the voice's formants (linear prediction) to pick the vowel shape, and its loudness to set how far the mouth opens. They also blink, breathe, keep eye contact and nod with the voice. In text mode, where the browser's voice can't be analysed, the mouth uses a syllable-paced animation instead.

- **Professor Whiskers, Ms. Luna, Coach Rex and Robo-Tutor** are original characters built from simple shapes in code, so they need no model files. Each is just a `Look` (colours, nose, hair, moustache or beard, glasses, hat, robot) in `web/src/avatar/characters.ts`; add an entry there to make another.
- **Anime teacher** is a [VRM](https://vrm.dev) model rendered with [@pixiv/three-vrm](https://github.com/pixiv/three-vrm) (MIT), `web/public/models/teacher.vrm`, the sample avatar by pixiv Inc. Its license allows redistribution and modification with no credit required. To add your own VRM 0.x or 1.0 model, put the file in that folder, add an entry to `characters.ts` (with a `credit` line if its license requires one, which the app then shows under the character), and check its license first. It needs the `aa`, `ih`, `ou`, `ee` and `oh` expressions for lip sync.
