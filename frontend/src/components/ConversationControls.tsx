import { useTranslation } from "react-i18next";

interface Props {
  /** Something is happening that can be stopped: speech, a reply being written, a call, the microphone. */
  canStop: boolean;
  canExport: boolean;
  /** Everything but Stop waits while the room is being prepared. */
  locked?: boolean;
  onStop: () => void;
  onExport: () => void;
}

/** Stop the conversation and save its transcript. */
export default function ConversationControls({ canStop, canExport, locked, onStop, onExport }: Props) {
  const { t } = useTranslation();
  return (
    <>
      <button type="button" className="toggle stop" disabled={!canStop} onClick={onStop}>
        ⏹ {t("toolbar.stop")}
      </button>
      <button type="button" className="toggle" disabled={!canExport || locked} onClick={onExport}>
        ⬇ {t("toolbar.export")}
      </button>
    </>
  );
}
