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
}

export type Character =
  | { id: string; name: string; kind: "cartoon"; look: Look; credit?: string }
  | { id: string; name: string; kind: "vrm"; url: string; credit?: string };

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
  },
  { id: "anime", name: "Anime teacher", kind: "vrm", url: "/models/teacher.vrm" },
  {
    id: "seed",
    name: "Seed-san (anime)",
    kind: "vrm",
    url: "/models/seed-san.vrm",
    credit: "Seed-san by VirtualCast, Inc. (VRM sample avatar)",
  },
];

export const DEFAULT_CHARACTER = CHARACTERS[0].id;
