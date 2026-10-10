/** Mouth shapes, using the five standard VRM expression names. */
export interface Visemes {
  aa: number;
  ih: number;
  ou: number;
  ee: number;
  oh: number;
}

export const SILENT: Visemes = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Typical first and second formants (Hz) of the vowel each mouth shape makes. */
const VOWELS: Record<"aa" | "ee" | "oh" | "ou", [number, number]> = {
  aa: [750, 1200], // "ah": jaw wide open
  ee: [400, 2100], // "ee/eh": lips spread
  oh: [550, 900], //  "oh": rounded, mid open
  ou: [330, 850], //   "oo": lips pursed
};

const LPC_ORDER = 12;
const TARGET_RATE = 12000;

/**
 * Estimates the first two vowel formants (resonances of the mouth) from one frame of voice samples,
 * using linear prediction: the standard way to measure them. Returns null when there is no clear voice.
 */
export function estimateFormants(samples: Float32Array, sampleRate: number): { f1: number; f2: number } | null {
  // Reduce to about 12 kHz by averaging, which also acts as a low-pass filter.
  const factor = Math.max(1, Math.round(sampleRate / TARGET_RATE));
  const rate = sampleRate / factor;
  const n = Math.floor(samples.length / factor);
  if (n < 64) return null;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < factor; j++) sum += samples[i * factor + j];
    x[i] = sum / factor;
  }
  // Pre-emphasis flattens the voice's falling spectrum; the window avoids edge artefacts.
  for (let i = n - 1; i > 0; i--) x[i] -= 0.97 * x[i - 1];
  for (let i = 0; i < n; i++) x[i] *= 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1));

  const r = new Float64Array(LPC_ORDER + 1);
  for (let k = 0; k <= LPC_ORDER; k++) {
    let sum = 0;
    for (let i = k; i < n; i++) sum += x[i] * x[i - k];
    r[k] = sum;
  }
  if (r[0] < 1e-9) return null;
  r[0] *= 1.0001; // keeps the maths stable

  // Levinson-Durbin recursion for the prediction coefficients.
  const a = new Float64Array(LPC_ORDER + 1);
  a[0] = 1;
  let err = r[0];
  for (let i = 1; i <= LPC_ORDER; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) acc += a[j] * r[i - j];
    const k = -acc / err;
    const prev = a.slice();
    for (let j = 1; j < i; j++) a[j] = prev[j] + k * prev[i - j];
    a[i] = k;
    err *= 1 - k * k;
    if (err <= 0) return null;
  }

  // The spectral envelope has one peak per formant; take the first two above the voice pitch.
  const step = 20;
  const peaks: number[] = [];
  let before = 0, current = 0;
  for (let f = 200; f <= 3800; f += step) {
    const w = (2 * Math.PI * f) / rate;
    let re = 1, im = 0;
    for (let k = 1; k <= LPC_ORDER; k++) {
      re += a[k] * Math.cos(w * k);
      im -= a[k] * Math.sin(w * k);
    }
    const next = 1 / Math.hypot(re, im);
    if (current > before && current > next && peaks.length < 2 && f - step >= 250) peaks.push(f - step);
    before = current;
    current = next;
  }
  return peaks.length === 2 ? { f1: peaks[0], f2: peaks[1] } : null;
}

/** Blend of the four vowel shapes whose formants are closest to the measured ones; weights sum to 1. */
export function vowelWeights(f1: number, f2: number): Pick<Visemes, "aa" | "ee" | "oh" | "ou"> {
  const raw = { aa: 0, ee: 0, oh: 0, ou: 0 };
  let sum = 0;
  for (const key of Object.keys(VOWELS) as (keyof typeof VOWELS)[]) {
    const [a1, a2] = VOWELS[key];
    const d2 = ((f1 - a1) / 170) ** 2 + ((f2 - a2) / 450) ** 2;
    raw[key] = Math.exp(-d2 / 2);
    sum += raw[key];
  }
  for (const key of Object.keys(raw) as (keyof typeof raw)[]) raw[key] /= sum || 1;
  return raw;
}

/** Share of the energy above 4 kHz in an analyser frame (dB), which is high for s, sh and f sounds. */
export function hissShare(db: Float32Array, sampleRate: number): number {
  const binHz = sampleRate / 2 / db.length;
  let high = 0, total = 0;
  for (let i = 1; i < db.length; i++) {
    const f = i * binHz;
    if (f < 200 || f > 8000) continue;
    const power = Math.pow(10, db[i] / 10);
    total += power;
    if (f >= 4000) high += power;
  }
  return total > 0 ? high / total : 0;
}

/** How far the jaw opens for a given loudness (RMS of samples in -1..1). */
export function openness(rms: number): number {
  const db = 20 * Math.log10(rms + 1e-9);
  return smoothstep(-48, -16, db);
}

/** Moves each mouth shape toward its target: quickly on the way open, a little slower on the way shut. */
function approach(current: Visemes, target: Visemes, dt: number): void {
  for (const key of Object.keys(current) as (keyof Visemes)[]) {
    const tau = target[key] > current[key] ? 0.04 : 0.09;
    current[key] += (target[key] - current[key]) * (1 - Math.exp(-dt / tau));
  }
}

/** Mouth movement driven by the teacher's actual audio, so it follows what is really being said. */
export class AudioLipSync {
  readonly visemes: Visemes = { ...SILENT };
  /** 0..1 loudness, handy for head movement that follows the voice. */
  level = 0;
  private freq: Float32Array<ArrayBuffer>;
  private wave: Float32Array<ArrayBuffer>;
  private vowel = { aa: 0.25, ee: 0.25, oh: 0.25, ou: 0.25 };

  constructor(private analyser: AnalyserNode) {
    this.freq = new Float32Array(analyser.frequencyBinCount);
    this.wave = new Float32Array(analyser.fftSize);
  }

  update(dt: number): void {
    this.analyser.getFloatTimeDomainData(this.wave);
    let sum = 0;
    for (const s of this.wave) sum += s * s;
    const open = openness(Math.sqrt(sum / this.wave.length));
    this.level = open;

    const target = { ...SILENT };
    if (open > 0.03) {
      const rate = this.analyser.context.sampleRate;
      this.analyser.getFloatFrequencyData(this.freq);
      // s, sh, f: teeth close together and lips slightly spread, so little jaw and mostly "ih".
      const hiss = smoothstep(0.25, 0.6, hissShare(this.freq, rate));
      const formants = estimateFormants(this.wave, rate);
      // Keep the last good vowel through the odd frame where the measurement fails.
      if (formants) this.vowel = vowelWeights(formants.f1, formants.f2);
      const scale = open * 0.9 * (1 - hiss);
      target.aa = this.vowel.aa * scale;
      target.ee = this.vowel.ee * scale;
      target.oh = this.vowel.oh * scale;
      target.ou = this.vowel.ou * scale;
      target.ih = hiss * open * 0.6;
    }
    approach(this.visemes, target, dt);
  }
}

/** Stand-in for audio we can't analyse (browser speech synthesis): syllable-paced random vowels. */
export class SyntheticSpeech {
  readonly visemes: Visemes = { ...SILENT };
  level = 0;
  private phase = 0;
  private shape: keyof Visemes = "aa";
  private strength = 0.6;

  update(dt: number, speaking: boolean): void {
    const target = { ...SILENT };
    if (speaking) {
      const previous = this.phase;
      this.phase += dt * 5.5; // about 5 syllables per second
      if (Math.floor(this.phase) !== Math.floor(previous)) {
        const shapes: (keyof Visemes)[] = ["aa", "aa", "ee", "oh", "ou", "ih"];
        this.shape = shapes[Math.floor(Math.random() * shapes.length)];
        this.strength = 0.35 + Math.random() * 0.5;
      }
      // Open in the middle of each syllable and close between them.
      const open = Math.sin((this.phase % 1) * Math.PI) ** 0.7;
      target[this.shape] = open * this.strength;
      this.level = open * this.strength;
    } else {
      this.level = 0;
    }
    approach(this.visemes, target, dt);
  }
}
