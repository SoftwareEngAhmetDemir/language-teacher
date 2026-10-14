export interface ExportLine {
  speaker: string;
  text: string;
  /** The line was cut off because the student talked over it. */
  interrupted?: boolean;
}

/** Saves the conversation as a plain-text file. `fileName` is the name without extension, so it stays plain ASCII whatever language the title is in. */
export function exportConversation(title: string, lines: ExportLine[], fileName: string) {
  const now = new Date();
  const body = lines
    .filter((l) => l.text.trim())
    .map((l) => `${l.speaker}: ${l.text.trim()}${l.interrupted ? " —" : ""}`)
    .join("\n\n");
  const text = `${title}\n${now.toLocaleString()}\n\n${body}\n`;

  const slug = fileName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  link.download = `${slug}-${now.toISOString().slice(0, 10)}.txt`;
  link.click();
  URL.revokeObjectURL(link.href);
}
