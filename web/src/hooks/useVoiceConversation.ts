import { useCallback, useEffect, useRef, useState } from "react";
import { LiveConversation, type VoiceEvent } from "../lib/liveConversation";
import type { Message } from "../lib/types";

export type CallStatus = "idle" | "connecting" | "live";

const nextId = (messages: Message[]) => (messages.length ? messages[messages.length - 1].id + 1 : 1);
const closeLast = (messages: Message[], patch: Partial<Message> = {}) =>
  messages.map((m, i) => (i === messages.length - 1 && m.open ? { ...m, open: false, ...patch } : m));

/** Folds a transcript event into the chat log: one bubble per turn, growing as words arrive. */
function applyEvent(messages: Message[], event: VoiceEvent): Message[] {
  const last = messages[messages.length - 1];
  switch (event.type) {
    case "input_transcript": {
      if (last?.role === "user" && last.open) {
        return messages.map((m, i) => (i === messages.length - 1 ? { ...m, text: m.text + event.text } : m));
      }
      // Speaking over the teacher cuts their message short.
      const base = last?.role === "assistant" && last.open ? closeLast(messages, { interrupted: true }) : messages;
      return [...base, { id: nextId(base), role: "user", text: event.text, open: true }];
    }
    case "output_transcript": {
      if (last?.role === "assistant" && last.open) {
        return messages.map((m, i) => (i === messages.length - 1 ? { ...m, text: m.text + event.text } : m));
      }
      const base = last?.role === "user" && last.open ? closeLast(messages) : messages;
      return [...base, { id: nextId(base), role: "assistant", text: event.text, open: true }];
    }
    case "interrupted":
      return closeLast(messages, { interrupted: true });
    case "turn_complete":
      return closeLast(messages);
    default:
      return messages;
  }
}

/** A hands-free voice call with the teacher through the Gemini Live API. */
export function useVoiceConversation() {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [teacherSpeaking, setTeacherSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const call = useRef<LiveConversation | null>(null);
  // Ignores events from a call that was already replaced or ended.
  const callId = useRef(0);

  const stop = useCallback(() => {
    callId.current++;
    call.current?.stop();
    call.current = null;
    setAnalyser(null);
    setStatus("idle");
    setTeacherSpeaking(false);
    setMuted(false);
    setMessages((m) => closeLast(m));
  }, []);

  const start = useCallback(
    async (lesson: { language: string; level: string; character: string }) => {
      if (call.current || status !== "idle") return;
      const id = ++callId.current;
      setError(null);
      setStatus("connecting");
      try {
        const conversation = await LiveConversation.start(lesson, {
          onEvent: (event) => {
            if (id !== callId.current) return;
            if (event.type === "error") setError(event.message);
            else setMessages((m) => applyEvent(m, event));
          },
          onSpeaking: (speaking) => id === callId.current && setTeacherSpeaking(speaking),
          onClose: () => {
            if (id !== callId.current) return;
            call.current = null;
            setAnalyser(null);
            setStatus("idle");
            setTeacherSpeaking(false);
            setMuted(false);
            setMessages((m) => closeLast(m));
          },
        });
        if (id !== callId.current) return conversation.stop();
        call.current = conversation;
        setAnalyser(conversation.analyser);
        setStatus("live");
      } catch (e) {
        if (id !== callId.current) return;
        const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
        setError(
          denied ? "Microphone access was blocked. Allow it in your browser's site settings." : (e as Error).message,
        );
        setStatus("idle");
      }
    },
    [status],
  );

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      call.current?.setMuted(!current);
      return !current;
    });
  }, []);

  const sendText = useCallback((text: string) => {
    if (!call.current || !text.trim()) return;
    call.current.sendText(text);
    setMessages((m) => [...closeLast(m), { id: nextId(m), role: "user", text }]);
  }, []);

  const clear = useCallback(() => setMessages([]), []);

  useEffect(() => stop, [stop]);

  return { status, teacherSpeaking, muted, messages, error, analyser, start, stop, toggleMute, sendText, clear, clearError: () => setError(null) };
}
