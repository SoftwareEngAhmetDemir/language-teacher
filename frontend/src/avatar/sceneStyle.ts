import { paletteFor, type Palette } from "./room";

/** What can stand in the room; the server chooses among these for the student's own topic. */
export type PropId = "bookcase" | "plant" | "map" | "tv" | "guitar" | "ball" | "globe" | "suitcase" | "easel" | "flowers" | "food" | "laptop";
export type Sky = "day" | "sunset" | "night";

/** How a room looks: its colours, what stands in it and what is seen through the window. */
export interface SceneStyle {
  palette: Palette;
  props: PropId[];
  sky: Sky;
}

const PROP_IDS: readonly string[] = ["bookcase", "plant", "map", "tv", "guitar", "ball", "globe", "suitcase", "easel", "flowers", "food", "laptop"];

/** What each ready-made scene has in its room. */
const PRESETS: Record<string, { props: PropId[]; sky: Sky }> = {
  cafe: { props: ["bookcase", "plant", "flowers"], sky: "day" },
  study: { props: ["bookcase", "plant", "laptop"], sky: "day" },
  dinner: { props: ["bookcase", "plant", "food"], sky: "sunset" },
  travel: { props: ["map", "suitcase", "globe", "plant", "flowers"], sky: "day" },
  weekend: { props: ["bookcase", "plant", "ball", "guitar", "flowers"], sky: "day" },
};

export function presetStyle(sceneId?: string): SceneStyle {
  const preset = PRESETS[sceneId ?? ""] ?? PRESETS.cafe;
  return { palette: paletteFor(sceneId), ...preset };
}

const HEX = /^#[0-9a-f]{6}$/i;
const TEXT_COLOURS = ["wallTop", "wallBottom", "panel", "floor", "rug"] as const;
const NUMBER_COLOURS = ["table", "rim", "chair", "lamp", "curtain", "decor"] as const;

/** Reads the server's room design (colours as `#rrggbb`) into a style, or null if it is not usable. */
export function styleFromServer(raw: unknown): SceneStyle | null {
  const r = raw as { palette?: Record<string, unknown>; props?: unknown; sky?: unknown } | null;
  if (!r || typeof r !== "object" || !r.palette || typeof r.palette !== "object") return null;
  const palette: Record<string, string | number> = {};
  for (const key of [...TEXT_COLOURS, ...NUMBER_COLOURS]) {
    const value = r.palette[key];
    if (typeof value !== "string" || !HEX.test(value)) return null;
    palette[key] = (NUMBER_COLOURS as readonly string[]).includes(key) ? parseInt(value.slice(1), 16) : value;
  }
  const props = Array.isArray(r.props) ? (r.props.filter((p) => typeof p === "string" && PROP_IDS.includes(p)) as PropId[]) : [];
  const sky: Sky = r.sky === "night" || r.sky === "sunset" ? r.sky : "day";
  return { palette: palette as unknown as Palette, props, sky };
}
