import type { TFunction } from "i18next";
import i18n, { UI_LANGUAGES } from "./index";

/*
 * Names that come from the server (languages, levels, scenes, characters) are looked up by id so they can be shown in
 * the interface language. Anything the locale files don't know yet falls back to the server's own text.
 */
type Lookup = (key: string, options: { defaultValue: string }) => string;
const lookup = (t: TFunction): Lookup => t as unknown as Lookup;

/** A language being practised, such as "Turkish", in the interface language. */
export const languageLabel = (t: TFunction, name: string) => lookup(t)(`languages.${name}`, { defaultValue: name });

/** The same name for the middle of a sentence: Spanish writes languages in lower case ("practica turco"). */
export function languageInline(t: TFunction, name: string): string {
  const label = languageLabel(t, name);
  const ui = UI_LANGUAGES.find((l) => l.code === i18n.resolvedLanguage);
  return ui && "lowercaseLanguageNames" in ui ? label.toLocaleLowerCase(ui.code) : label;
}

/** A CEFR level, such as "A1 · Beginner". */
export const levelLabel = (t: TFunction, level: string) => lookup(t)(`levels.${level}`, { defaultValue: level });

/** A ready-made group scene's title. */
export const sceneTitle = (t: TFunction, id: string, fallback: string) => lookup(t)(`scenes.${id}`, { defaultValue: fallback });

/** A group character's role, shown as a tooltip. */
export const characterRole = (t: TFunction, id: string, fallback: string) => lookup(t)(`roles.${id}`, { defaultValue: fallback });
