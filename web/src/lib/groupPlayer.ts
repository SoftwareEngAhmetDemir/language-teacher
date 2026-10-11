import { openSpeech } from "./api";
import { voicesForLanguage } from "./speech";

const SAMPLE_RATE = 24000;
/** If a character's voice hasn't started within this long, the browser's voice speaks the line instead. */
const FIRST_AUDIO_TIMEOUT_MS = 8000;

/** A person who has finished speaking leaves a short silence before the next one starts, a little longer after a question. */
function turnGap(text: string): number {
  const question = /[?？]["')\]]*\s*$/.test(text.trim());
  return (question ? 450 : 250) + Math.random() * 250;
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** One line waiting to be heard. */
export interface SpokenLine {
  id: number;
  speaker: string;
  text: string;
  /** Who the line is said to: a character id, "user" for the student, or nothing for the whole table. */
  addressee?: string;
  /** The browser voice to use if the character's own voice can't be fetched. */
  fallback: { tag: string; pitch: number; rate: number };
}

export interface PlayerEvents {
  /** Which kind of voice a line is heard in: the character's natural Gemini voice, or the browser's, with the reason. */
  onVoice?(natural: boolean, reason?: string): void;
  /** The line starts being heard (or, with voices off, shown). */
  onStart(line: SpokenLine): void;
  /** The line is over; `completed` is false when it was cut off. */
  onEnd(line: SpokenLine, completed: boolean): void;
}

/** One line's audio, arriving in pieces from the server while the line is still being generated. */
class Clip {
  readonly segments: AudioBuffer[] = [];
  done = false;
  failure?: string;
  /** Called when a new piece arrives or the clip ends; set by whoever is playing it. */
  onChange: (() => void) | null = null;
  /** Resolves when there is something to act on: the first piece, the end, or a failure. */
  readonly ready: Promise<void>;
  private resolveReady!: () => void;

  constructor() {
    this.ready = new Promise((resolve) => (this.resolveReady = resolve));
  }

  push(buffer: AudioBuffer): void {
    this.segments.push(buffer);
    this.resolveReady();
    this.onChange?.();
  }

  finish(failure?: string): void {
    if (this.done) return;
    this.done = true;
    if (failure && this.segments.length === 0) this.failure = failure;
    this.resolveReady();
    this.onChange?.();
  }
}

interface Queued {
  line: SpokenLine;
  clip: Clip;
  abort: AbortController;
}

/**
 * Plays group-conversation lines one after another, each in its character's voice.
 *
 * Each line's audio is requested as soon as the line is written and plays as its first pieces arrive, not
 * after the whole line is generated, so a voice starts within a second or so. While one line is playing, the
 * next ones are already being fetched. Every character plays through its own analyser, which the 3D scene
 * reads to move that character's mouth. If a voice doesn't start in time or fails, the browser's voice takes over.
 */
export class GroupPlayer {
  private ctx: AudioContext | null = null;
  private analysers = new Map<string, AnalyserNode>();
  private queue: Queued[] = [];
  private current: { stop: () => void } | null = null;
  /** The line whose first audio is still being waited for. */
  private loading: Queued | null = null;
  private idleWaiters: (() => void)[] = [];
  private backlogWaiters: { limit: number; resolve: () => void }[] = [];
  /** Lines queued, loading or playing. */
  private inFlight = 0;
  private pumping = false;
  /** When the last line ended and what it said, so the next speaker waits a natural moment. */
  private lastEnd: { at: number; text: string } | null = null;
  /** The browser voice each character uses when their own voice isn't available, so they don't all sound alike. */
  private assigned = new Map<string, SpeechSynthesisVoice>();

  constructor(
    private events: PlayerEvents,
    /** When false, lines are shown at reading pace without any audio. */
    public voice: () => boolean,
  ) {}

  /** Call from a click or key press so the browser allows audio. */
  unlock(): void {
    this.context().resume().catch(() => {});
  }

  analyserFor(speaker: string): AnalyserNode | null {
    return this.analysers.get(speaker) ?? null;
  }

  enqueue(line: SpokenLine): void {
    const abort = new AbortController();
    const clip = new Clip();
    if (this.voice()) this.fetchClip(line, clip, abort);
    else clip.finish();
    this.queue.push({ line, clip, abort });
    this.inFlight++;
    void this.pump();
  }

  /** Resolves when nothing is queued or playing. */
  whenIdle(): Promise<void> {
    if (!this.pumping && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /** Resolves when at most `limit` lines are left to be heard, including the one being spoken. */
  whenBacklogAtMost(limit: number): Promise<void> {
    if (this.inFlight <= limit) return Promise.resolve();
    return new Promise((resolve) => this.backlogWaiters.push({ limit, resolve }));
  }

  /** Drops everything queued and cuts off whatever is playing. */
  stop(): void {
    for (const item of this.queue) item.abort.abort();
    this.queue = [];
    this.loading?.abort.abort();
    this.current?.stop();
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    this.inFlight = 0;
    this.lastEnd = null;
    this.resolveIdle();
    this.resolveBacklog();
  }

  dispose(): void {
    this.stop();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.analysers.clear();
    this.assigned.clear();
  }

  private context(): AudioContext {
    return (this.ctx ??= new AudioContext({ latencyHint: "interactive" }));
  }

  private analyserNode(speaker: string): AnalyserNode {
    let node = this.analysers.get(speaker);
    if (!node) {
      const ctx = this.context();
      node = ctx.createAnalyser();
      node.fftSize = 1024;
      node.smoothingTimeConstant = 0.4;
      node.connect(ctx.destination);
      this.analysers.set(speaker, node);
    }
    return node;
  }

  /** Turns raw 16-bit mono PCM into something the browser can play. */
  private decode(bytes: Uint8Array): AudioBuffer {
    const samples = new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const buffer = this.context().createBuffer(1, samples.length, SAMPLE_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 0x8000;
    return buffer;
  }

  /** Starts fetching a line's voice and feeds the clip as audio arrives. */
  private fetchClip(line: SpokenLine, clip: Clip, abort: AbortController): void {
    const timer = window.setTimeout(() => {
      if (clip.segments.length === 0) {
        abort.abort();
        clip.finish("The voice took too long to start");
      }
    }, FIRST_AUDIO_TIMEOUT_MS);

    void (async () => {
      try {
        const response = await openSpeech(line.text, line.speaker, abort.signal);
        const reader = response.body!.getReader();
        let carry: number | null = null; // a 16-bit sample can be split across two chunks
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          let bytes = value;
          if (carry !== null) {
            const joined = new Uint8Array(bytes.length + 1);
            joined[0] = carry;
            joined.set(bytes, 1);
            bytes = joined;
            carry = null;
          }
          if (bytes.length % 2) {
            carry = bytes[bytes.length - 1];
            bytes = bytes.subarray(0, bytes.length - 1);
          }
          if (bytes.length) {
            window.clearTimeout(timer);
            clip.push(this.decode(bytes));
          }
        }
        clip.finish(clip.segments.length ? undefined : "The voice returned no audio");
      } catch (err) {
        const failure = err instanceof Error ? err.message : String(err);
        if (!abort.signal.aborted) console.warn("Using the browser voice for a line:", failure);
        clip.finish(failure);
      } finally {
        window.clearTimeout(timer);
      }
    })();
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length) {
        const item = this.queue.shift()!;
        this.loading = item;
        await item.clip.ready;
        this.loading = null;
        if (!item.abort.signal.aborted) {
          await this.waitForTurn();
        }
        if (!item.abort.signal.aborted) {
          if (item.clip.segments.length) await this.playClip(item);
          else await this.playFallback(item, item.clip.failure);
          this.lastEnd = { at: performance.now(), text: item.line.text };
        }
        this.inFlight = Math.max(0, this.inFlight - 1);
        this.resolveBacklog();
      }
    } finally {
      this.pumping = false;
      this.current = null;
      this.resolveIdle();
    }
  }

  /**
   * Waits until the previous speaker has really finished (a browser voice can still be talking after its line was
   * counted as over) and a natural moment of silence has passed, so people never talk over each other.
   */
  private async waitForTurn(): Promise<void> {
    if ("speechSynthesis" in window) {
      for (let waited = 0; speechSynthesis.speaking && waited < 4000; waited += 100) await sleep(100);
    }
    if (this.lastEnd) {
      const wait = this.lastEnd.at + turnGap(this.lastEnd.text) - performance.now();
      if (wait > 0) await sleep(wait);
    }
  }

  /** Plays a line in its character's own voice, piece by piece as the pieces arrive. */
  private playClip(item: Queued): Promise<void> {
    const { clip, line } = item;
    return new Promise((resolve) => {
      const ctx = this.context();
      const analyser = this.analyserNode(line.speaker);
      const sources: AudioBufferSourceNode[] = [];
      let scheduled = 0;
      let playing = 0;
      let nextStart = 0;
      let finished = false;

      const finish = (completed: boolean) => {
        if (finished) return;
        finished = true;
        clip.onChange = null;
        this.current = null;
        this.events.onEnd(line, completed);
        resolve();
      };
      const checkEnd = () => {
        if (clip.done && scheduled === clip.segments.length && playing === 0) finish(true);
      };
      // Queue every piece that has arrived, back to back; a piece that arrives late just starts when it can.
      const schedule = () => {
        while (scheduled < clip.segments.length) {
          const buffer = clip.segments[scheduled];
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(analyser);
          const startAt = Math.max(nextStart, ctx.currentTime + (scheduled === 0 ? 0.04 : 0.01));
          source.start(startAt);
          nextStart = startAt + buffer.duration;
          scheduled++;
          playing++;
          sources.push(source);
          source.onended = () => {
            playing--;
            checkEnd();
          };
        }
        checkEnd();
      };

      this.events.onStart(line);
      this.events.onVoice?.(true);
      this.current = {
        stop: () => {
          clip.onChange = null;
          item.abort.abort();
          for (const source of sources) {
            source.onended = null;
            try {
              source.stop();
            } catch {
              // Already finished.
            }
          }
          finish(false);
        },
      };
      clip.onChange = schedule;
      schedule();
    });
  }

  /** The browser voice for a character, different from the other characters' where the device has enough voices. */
  private fallbackVoice(speaker: string, tag: string): { voice?: SpeechSynthesisVoice; shared: boolean } {
    const voices = voicesForLanguage(tag, speechSynthesis.getVoices());
    if (!voices.length) return { shared: true };
    let voice = this.assigned.get(speaker);
    if (!voice || !voices.includes(voice)) {
      const taken = new Set(this.assigned.values());
      voice = voices.find((v) => !taken.has(v)) ?? voices[this.assigned.size % voices.length];
      this.assigned.set(speaker, voice);
    }
    return { voice, shared: voices.length < 2 };
  }

  /** Speaks a line with the browser's voice, or just shows it for reading time when voices are off. */
  private playFallback(item: Queued, failure?: string): Promise<void> {
    return new Promise((resolve) => {
      let finished = false;
      const finish = (completed: boolean) => {
        if (finished) return;
        finished = true;
        this.current = null;
        this.events.onEnd(item.line, completed);
        resolve();
      };

      this.events.onStart(item.line);
      if (this.voice()) this.events.onVoice?.(false, failure);
      if (this.voice() && "speechSynthesis" in window) {
        const { tag, pitch, rate } = item.line.fallback;
        const utterance = new SpeechSynthesisUtterance(item.line.text);
        utterance.lang = tag;
        const { voice, shared } = this.fallbackVoice(item.line.speaker, tag);
        if (voice) utterance.voice = voice;
        // Different voices already set characters apart, so only nudge pitch and pace; with one voice, vary it more.
        utterance.pitch = 1 + (pitch - 1) * (shared ? 0.6 : 0.3);
        utterance.rate = 1 + (rate - 1) * 0.6;
        // Some browsers never report the end of a spoken line (for example with no voice installed), so give up waiting after a while.
        const timer = window.setTimeout(() => finish(true), 3000 + item.line.text.length * 120);
        utterance.onend = () => (window.clearTimeout(timer), finish(true));
        utterance.onerror = () => (window.clearTimeout(timer), finish(false));
        this.current = { stop: () => { window.clearTimeout(timer); utterance.onend = utterance.onerror = null; speechSynthesis.cancel(); finish(false); } };
        speechSynthesis.speak(utterance);
      } else {
        // Voices off: leave the line up for as long as it takes to read.
        const timer = window.setTimeout(() => finish(true), Math.min(2500, 400 + item.line.text.length * 35));
        this.current = { stop: () => { window.clearTimeout(timer); finish(false); } };
      }
    });
  }

  private resolveIdle(): void {
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    waiters.forEach((w) => w());
  }

  private resolveBacklog(): void {
    const ready = this.backlogWaiters.filter((w) => this.inFlight <= w.limit);
    this.backlogWaiters = this.backlogWaiters.filter((w) => this.inFlight > w.limit);
    ready.forEach((w) => w.resolve());
  }
}
