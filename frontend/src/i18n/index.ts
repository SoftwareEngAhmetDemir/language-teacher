import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import tr from "./locales/tr.json";
import ar from "./locales/ar.json";
import es from "./locales/es.json";

/** The shape of every locale file, taken from English: a locale with a missing key fails to compile. */
export type Messages = typeof en;

/** Interface languages. Names are written in their own language so they can always be found. */
export const UI_LANGUAGES = [
  { code: "en", name: "English", dir: "ltr" },
  { code: "tr", name: "Türkçe", dir: "ltr" },
  { code: "ar", name: "العربية", dir: "rtl" },
  { code: "es", name: "Español", dir: "ltr", lowercaseLanguageNames: true },
] as const;

export type UiLanguage = (typeof UI_LANGUAGES)[number]["code"];

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: Messages };
  }
}

const resources = {
  en: { translation: en },
  tr: { translation: tr satisfies Messages },
  ar: { translation: ar satisfies Messages },
  es: { translation: es satisfies Messages },
};

/** Keeps the page's language, writing direction and title in step with the chosen interface language. */
function syncDocument(code: string) {
  const ui = UI_LANGUAGES.find((l) => l.code === code) ?? UI_LANGUAGES[0];
  document.documentElement.lang = ui.code;
  document.documentElement.dir = ui.dir;
  document.title = i18n.t("app.title");
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    supportedLngs: UI_LANGUAGES.map((l) => l.code),
    fallbackLng: "en",
    // "tr-TR" and "es-MX" use the Turkish and Spanish texts.
    load: "languageOnly",
    // The choice is remembered like the other small settings; the browser's language is the first guess.
    detection: { order: ["localStorage", "navigator"], lookupLocalStorage: "uiLanguage", caches: ["localStorage"] },
    // React already escapes what it renders.
    interpolation: { escapeValue: false },
  });

syncDocument(i18n.resolvedLanguage ?? "en");
i18n.on("languageChanged", () => syncDocument(i18n.resolvedLanguage ?? "en"));

export default i18n;
