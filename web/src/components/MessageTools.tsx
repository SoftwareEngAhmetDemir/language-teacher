import { useEffect, useRef, useState, type ReactNode } from "react";
import { translate } from "../lib/api";
import { loadPref, savePref } from "../lib/prefs";

interface Props {
  text: string;
  role: "user" | "assistant";
  /** Languages the student can translate into. */
  languages: string[];
  /** Language shown first, until the student picks another. */
  defaultTarget: string;
  /** Extra buttons shown next to Translate, such as Replay. */
  children?: ReactNode;
}

type Status = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string };

/** Under a transcript message: a Translate button that opens a language picker and the translation. */
export default function MessageTools({ text, role, languages, defaultTarget, children }: Props) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(() => {
    const saved = loadPref("translateTo", defaultTarget);
    return languages.includes(saved) ? saved : defaultTarget;
  });
  // Translations already fetched for this message, so switching languages back and forth is instant.
  const [results, setResults] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number>(0);
  const translation = results[target];

  useEffect(() => {
    if (!open || results[target]) return;
    const controller = new AbortController();
    setStatus({ kind: "loading" });
    translate(text, target, controller.signal)
      .then((result) => {
        setResults((r) => ({ ...r, [target]: result }));
        setStatus({ kind: "idle" });
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setStatus({ kind: "error", message: e.message });
      });
    return () => controller.abort();
  }, [open, target, text, attempt, results]);

  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(translation);
      setCopied(true);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be refused; the text can still be selected by hand.
    }
  }

  return (
    <div className={`tools ${role}`}>
      <div className="actions">
        <button type="button" className={`chip${open ? " active" : ""}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          🌐 Translate
        </button>
        {children}
      </div>

      {open && (
        <div className="translation" role="region" aria-label="Translation" aria-live="polite">
          <div className="translation-head">
            <label className="lang-picker">
              <span>Translate to</span>
              <select
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value);
                  savePref("translateTo", e.target.value);
                }}
              >
                {languages.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </label>
            <div className="translation-buttons">
              {translation && (
                <button type="button" className="icon" onClick={copy}>
                  {copied ? "✓ Copied" : "Copy"}
                </button>
              )}
              <button type="button" className="icon" aria-label="Close translation" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
          </div>

          {!translation && status.kind === "loading" && (
            <div className="skeleton" aria-label="Translating">
              <span />
              <span />
            </div>
          )}
          {status.kind === "error" && !translation && (
            <p className="translation-error">
              {status.message}{" "}
              <button type="button" className="link" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </button>
            </p>
          )}
          {translation && (
            <p className="translation-text" dir="auto">
              {translation}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
