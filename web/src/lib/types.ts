export type Engine = "text" | "voice";

export interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
  error?: boolean;
  timing?: string;
  /** Voice calls: still receiving transcript text for this turn. */
  open?: boolean;
  /** Voice calls: the student talked over the end of this message. */
  interrupted?: boolean;
}
