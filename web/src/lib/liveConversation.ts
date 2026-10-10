import { getCode } from "./api";

export type VoiceEvent =
  | { type: "input_transcript" | "output_transcript"; text: string }
  | { type: "interrupted" | "turn_complete" }
  | { type: "error"; message: string };

export interface Handlers {
  onEvent: (event: VoiceEvent) => void;
  /** True while teacher audio is playing. */
  onSpeaking: (speaking: boolean) => void;
  /** The call ended for any reason (the user hung up, the server closed, the network dropped). */
  onClose: () => void;
}

const SEND_RATE = 16000; // Gemini expects 16 kHz microphone audio
const RECEIVE_RATE = 24000; // and returns 24 kHz audio

/**
 * Runs inside the audio thread: turns microphone audio at the context's sample rate into
 * 16 kHz 16-bit PCM frames of 40 ms and posts them to the page.
 */
const CAPTURE_WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / ${SEND_RATE};
    this.t = 0;
    this.prev = 0;
    this.frame = new Int16Array(${SEND_RATE * 0.04});
    this.filled = 0;
  }
  process(inputs) {
    const x = inputs[0][0];
    if (!x) return true;
    let t = this.t;
    while (t + 1 < x.length) {
      const i = Math.floor(t);
      const a = i < 0 ? this.prev : x[i];
      const s = a + (x[i + 1] - a) * (t - i);
      this.frame[this.filled++] = Math.max(-1, Math.min(1, s)) * 0x7fff;
      if (this.filled === this.frame.length) {
        this.port.postMessage(this.frame.buffer.slice(0), []);
        this.filled = 0;
      }
      t += this.step;
    }
    this.t = t - x.length;
    this.prev = x[x.length - 1];
    return true;
  }
}
registerProcessor("capture", Capture);
`;

/** Plays streamed PCM chunks back to back, and can drop everything queued when the student interrupts. */
class Player {
  private nextStart = 0;
  private sources = new Set<AudioBufferSourceNode>();
  /** Everything played goes through here, so the avatar can read the audio to move its mouth. */
  readonly analyser: AnalyserNode;

  constructor(
    private ctx: AudioContext,
    private onSpeaking: (speaking: boolean) => void,
  ) {
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.4;
    this.analyser.connect(ctx.destination);
  }

  play(pcm: ArrayBuffer) {
    const samples = new Int16Array(pcm, 0, Math.floor(pcm.byteLength / 2));
    const buffer = this.ctx.createBuffer(1, samples.length, RECEIVE_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 0x8000;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser);
    // A small lead on the first chunk avoids a stutter before more audio arrives.
    const startAt = Math.max(this.nextStart, this.ctx.currentTime + 0.05);
    source.start(startAt);
    this.nextStart = startAt + buffer.duration;

    this.sources.add(source);
    this.onSpeaking(true);
    source.onended = () => {
      this.sources.delete(source);
      if (this.sources.size === 0) this.onSpeaking(false);
    };
  }

  flush() {
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already finished.
      }
    }
    this.sources.clear();
    this.nextStart = 0;
    this.onSpeaking(false);
  }
}

/**
 * A live voice call with the teacher. The microphone is streamed continuously, so the student
 * can speak at any time, including over the teacher, and the server reports when that happens.
 */
export class LiveConversation {
  private constructor(
    private ws: WebSocket,
    private ctx: AudioContext,
    private stream: MediaStream,
    private player: Player,
  ) {}

  static async start(lesson: { language: string; level: string }, handlers: Handlers): Promise<LiveConversation> {
    // The browser's echo cancellation stops the teacher's voice from being picked up as the student's.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    const ctx = new AudioContext({ latencyHint: "interactive" });
    let ws: WebSocket | undefined;
    const cleanup = () => {
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close().catch(() => {});
      ws?.close();
    };

    try {
      await ctx.resume();
      const workletUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "application/javascript" }));
      try {
        await ctx.audioWorklet.addModule(workletUrl);
      } finally {
        URL.revokeObjectURL(workletUrl);
      }

      const player = new Player(ctx, handlers.onSpeaking);
      const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/live`);
      ws = socket;
      socket.binaryType = "arraybuffer";
      const call = new LiveConversation(socket, ctx, stream, player);

      await new Promise<void>((resolve, reject) => {
        let ready = false;
        socket.onopen = () => socket.send(JSON.stringify({ type: "start", ...lesson, code: getCode() }));
        socket.onmessage = (message) => {
          if (message.data instanceof ArrayBuffer) return player.play(message.data);
          const event = JSON.parse(message.data as string) as VoiceEvent | { type: "ready" };
          if (event.type === "ready") {
            ready = true;
            resolve();
          } else if (event.type === "error" && !ready) {
            reject(new Error(event.message));
          } else if (event.type === "interrupted") {
            player.flush();
            handlers.onEvent(event);
          } else {
            handlers.onEvent(event as VoiceEvent);
          }
        };
        socket.onerror = () => reject(new Error("Could not reach the voice service"));
        socket.onclose = () => {
          if (!ready) reject(new Error("The voice service closed the connection"));
          player.flush();
          call.release();
          handlers.onClose();
        };
      });

      // Only start sending microphone audio once the teacher is connected.
      const mic = ctx.createMediaStreamSource(stream);
      const capture = new AudioWorkletNode(ctx, "capture");
      capture.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(e.data);
      };
      // The node has to be connected to the output for the browser to run it; the gain keeps it silent.
      const silent = ctx.createGain();
      silent.gain.value = 0;
      mic.connect(capture).connect(silent).connect(ctx.destination);
      return call;
    } catch (err) {
      cleanup();
      throw err;
    }
  }

  /** The teacher's audio, for driving the avatar's lip sync. */
  get analyser(): AnalyserNode {
    return this.player.analyser;
  }

  /** Mutes the microphone without ending the call. */
  setMuted(muted: boolean) {
    this.stream.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }

  sendText(text: string) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "text", text }));
  }

  stop() {
    this.ws.close();
    this.release();
  }

  private release() {
    this.stream.getTracks().forEach((t) => t.stop());
    void this.ctx.close().catch(() => {});
  }
}
