import { useTranslation } from "react-i18next";
import { UI_LANGUAGES } from "./index";

/** Picks the language of the interface. The choice is remembered by the language detector. */
export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  return (
    <select
      className="ui-language"
      value={i18n.resolvedLanguage}
      aria-label={t("app.interfaceLanguage")}
      title={t("app.interfaceLanguage")}
      onChange={(e) => void i18n.changeLanguage(e.target.value)}
    >
      {UI_LANGUAGES.map((l) => (
        <option key={l.code} value={l.code} lang={l.code}>
          {l.name}
        </option>
      ))}
    </select>
  );
}
