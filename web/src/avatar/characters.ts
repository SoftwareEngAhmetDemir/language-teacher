/** How a cartoon teacher looks. Everything about the cartoon characters comes from here. */
export interface Look {
  skin: number;
  /** Nose colour and size (1 = the default big round nose). */
  nose: number;
  noseSize: number;
  /** Hair, eyebrows, moustache and beard. */
  hair: number;
  hairStyle: "none" | "short" | "bun";
  moustache?: boolean;
  beard?: boolean;
  blush?: boolean;
  glasses?: number;
  hat?: { kind: "mortarboard" | "cap"; color: number };
  body: number;
  collar?: boolean;
  bowTie?: number;
  whistle?: boolean;
  /** Makes a metal robot: the colours in `skin` and `body` become its metal, and `glow` its lights. */
  robot?: { glow: number };
}

/** Pitch and pace multipliers for the browser's built-in voice, used in text chat. Voice calls use Gemini voices chosen on the server. */
export interface SpeechStyle {
  pitch: number;
  rate: number;
}

export type Character =
  | { id: string; name: string; kind: "cartoon"; look: Look; speech: SpeechStyle; credit?: string }
  | { id: string; name: string; kind: "vrm"; url: string; speech: SpeechStyle; credit?: string };

export const CHARACTERS: Character[] = [
  {
    id: "professor",
    name: "Professor Whiskers",
    kind: "cartoon",
    look: {
      skin: 0xf3b284,
      nose: 0xe58f73,
      noseSize: 1,
      hair: 0x3a2415,
      hairStyle: "none",
      moustache: true,
      glasses: 0x2a2a2a,
      hat: { kind: "mortarboard", color: 0x1f2a5a },
      body: 0x2f9e78,
      collar: true,
      bowTie: 0xd62839,
    },
    speech: { pitch: 0.8, rate: 0.95 },
  },
  {
    id: "luna",
    name: "Ms. Luna",
    kind: "cartoon",
    look: {
      skin: 0xf1c1a0,
      nose: 0xe9a08a,
      noseSize: 0.55,
      hair: 0x5a3216,
      hairStyle: "bun",
      blush: true,
      glasses: 0xc2185b,
      body: 0x7a4fb5,
      collar: true,
    },
    speech: { pitch: 1.2, rate: 1.0 },
  },
  {
    id: "rex",
    name: "Coach Rex",
    kind: "cartoon",
    look: {
      skin: 0x8d5a3b,
      nose: 0x7c4a2f,
      noseSize: 0.75,
      hair: 0x1b1b1b,
      hairStyle: "none",
      beard: true,
      hat: { kind: "cap", color: 0x263238 },
      body: 0xe64a19,
      whistle: true,
    },
    speech: { pitch: 0.65, rate: 1.12 },
  },
  {
    id: "robot",
    name: "Robo-Tutor",
    kind: "cartoon",
    look: {
      skin: 0xb0bec5,
      nose: 0,
      noseSize: 0,
      hair: 0x37474f,
      hairStyle: "none",
      body: 0x5c7cfa,
      robot: { glow: 0x00e5ff },
    },
    speech: { pitch: 0.55, rate: 0.95 },
  },
  { id: "anime", name: "Anime teacher", kind: "vrm", url: "/models/teacher.vrm", speech: { pitch: 1.35, rate: 1.08 } },
];

export const DEFAULT_CHARACTER = CHARACTERS[0].id;
