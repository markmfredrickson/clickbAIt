/**
 * Transposition: manifest `transpose` spec → per-stem playback pitch + shifter.
 *
 * The spec is engine-agnostic (steps or a key pair, per-stem overrides, named
 * shifters); this module also carries the REAPER mapping — each named shifter's
 * RPP `pitchmode` int, encoded as `(mode << 16) | submode` and verified against
 * REAPER 7.78 by ReaScript enumeration (EnumPitchShiftModes). An offline
 * production path (clickbait-audio) can later map the same names to its own
 * engines; the manifest never stores raw ints except as an escape hatch.
 *
 * Defaults (from the Creep G→D shifter A/B, 2026-09-04, judged in the mix):
 * vocal stems → élastique Soloist Monophonic (best voice quality; known octave
 * flips on falsetto/harmonies — override to "pro-formants" when they bite);
 * everything else, DRUMS INCLUDED, → élastique Pro. Drums shift with the song
 * because demucs drum stems carry pitched bleed, and bleed a fourth off-key is
 * worse than the transient smear from shifting; pin a clean drum stem back to
 * 0 with `stems: { drums: 0 }`.
 */

/** Named shifters → REAPER item pitchmode ints ((mode << 16) | submode). */
export const SHIFTER_MODES = {
  /** élastique 3.3.3 Soloist / Monophonic — built for a solo voice. */
  soloist: (11 << 16) | 0,
  /** élastique 3.3.3 Pro / Normal — general polyphonic, no formant handling. */
  pro: (9 << 16) | 0,
  /** élastique 3.3.3 Pro / Preserve Formants (Most Pitches) — graceful
   *  fallback for vocals: phase vocoder, can't octave-glitch. */
  "pro-formants": (9 << 16) | 4,
  /** Rubber Band / Preserve Formants. */
  "rubberband-formants": (13 << 16) | 1,
} as const;

export type ShifterName = keyof typeof SHIFTER_MODES;

/** REAPER's "use project default shifter" sentinel. */
const PROJECT_DEFAULT = -1;

/** The manifest `transpose` value: bare semitones, or a spec object with
 *  either explicit `steps` or a `from`/`to` key pair (steps inferred), plus
 *  optional per-stem semitone and shifter overrides keyed by stem name. */
export type TransposeSpec =
  | number
  | {
      steps?: number;
      from?: string;
      to?: string;
      stems?: Record<string, number>;
      shifters?: Record<string, string | number>;
    };

/** Pitch class of a key string's tonic. Accepts bare notes ("G", "f#", "Bb")
 *  and tolerates mode suffixes as lookup returns them ("G major", "Em"). */
function pitchClass(key: string): number {
  const m = key.trim().match(/^([A-Ga-g])([#b♯♭]?)/);
  if (!m) throw new Error(`can't parse key "${key}" (expected a note name like "G", "F#", "Bb")`);
  const base: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  const acc = m[2] === "#" || m[2] === "♯" ? 1 : m[2] === "b" || m[2] === "♭" ? -1 : 0;
  return (base[m[1].toLowerCase()] + acc + 12) % 12;
}

/**
 * Semitone steps from one key to another, shortest distance; the tritone tie
 * (exactly 6 either way) resolves DOWN — large cover-band transposes usually
 * bring a song into a lower range.
 */
export function keyToSemitones(from: string, to: string): number {
  const diff = pitchClass(to) - pitchClass(from);
  return ((diff + 6 + 120) % 12) - 6;
}

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Transpose a note name with octave ("F#3" -5 → "C#3"). Output prefers
 *  sharps. Used to move prep-tone cue notes with the song. */
export function transposeNote(note: string, steps: number): string {
  const m = note.trim().match(/^([A-Ga-g])([#b♯♭]?)(-?\d+)$/);
  if (!m) throw new Error(`bad note name: ${note}`);
  const idx = pitchClass(m[1] + m[2]);
  const abs = (parseInt(m[3], 10) + 1) * 12 + idx + steps; // MIDI-style absolute
  const oct = Math.floor(abs / 12) - 1;
  return `${SHARP_NAMES[((abs % 12) + 12) % 12]}${oct}`;
}

/** Song-level steps from a spec. */
export function transposeSteps(spec: TransposeSpec): number {
  if (typeof spec === "number") return spec;
  if (spec.steps !== undefined) return spec.steps;
  if (spec.from !== undefined && spec.to !== undefined) return keyToSemitones(spec.from, spec.to);
  throw new Error("transpose spec needs `steps` or a `from`/`to` key pair");
}

/** Whether a stem name means the lead/backing voice ("vocals", "lead vocal"). */
function isVocalStem(stem: string): boolean {
  return /vocal|vox/i.test(stem);
}

/** Resolve a shifter override (name or raw pitchmode int) to an int. */
function shifterMode(v: string | number): number {
  if (typeof v === "number") return v;
  const mode = SHIFTER_MODES[v as ShifterName];
  if (mode === undefined) {
    throw new Error(`unknown shifter "${v}" (have: ${Object.keys(SHIFTER_MODES).join(", ")})`);
  }
  return mode;
}

/**
 * The playback pitch (semitones) and REAPER shifter mode for one stem under a
 * transpose spec. No spec, or a resolved shift of 0, returns `{0, -1}` —
 * byte-identical to an untransposed build.
 */
export function stemPlayback(
  stem: string,
  spec: TransposeSpec | undefined,
): { pitch: number; mode: number } {
  if (spec === undefined) return { pitch: 0, mode: PROJECT_DEFAULT };
  const songSteps = transposeSteps(spec);
  const overrides = typeof spec === "number" ? undefined : spec.stems;
  const pitch = overrides?.[stem] ?? songSteps;
  if (pitch === 0) return { pitch: 0, mode: PROJECT_DEFAULT };

  const shifters = typeof spec === "number" ? undefined : spec.shifters;
  const override = shifters?.[stem];
  const mode =
    override !== undefined
      ? shifterMode(override)
      : isVocalStem(stem)
        ? SHIFTER_MODES.soloist
        : SHIFTER_MODES.pro;
  return { pitch, mode };
}
