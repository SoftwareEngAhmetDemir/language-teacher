interface Props {
  /** Something is happening that can be stopped: speech, a reply being written, a call, the microphone. */
  canStop: boolean;
  canExport: boolean;
  onStop: () => void;
  onExport: () => void;
}

/** Stop the conversation and save its transcript. */
export default function ConversationControls({ canStop, canExport, onStop, onExport }: Props) {
  return (
    <>
      <button type="button" className="toggle stop" disabled={!canStop} onClick={onStop}>
        ⏹ Stop conversation
      </button>
      <button type="button" className="toggle" disabled={!canExport} onClick={onExport}>
        ⬇ Export conversation
      </button>
    </>
  );
}
