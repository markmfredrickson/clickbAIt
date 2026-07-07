/**
 * Post-DBN beat-grid QC (flag-only).
 *
 * The DBN beat tracker sometimes misplaces beats — especially in sparse
 * passages (quiet intros, drum-light sections). A misplaced beat becomes a
 * stretch marker that warps the audio noticeably when the stems are pinned to a
 * constant-BPM click. This pass measures, for each inter-beat interval, how far
 * it deviates from the song's CONSTANT beat length and flags the big ones.
 *
 * Reference is the STABLE, whole-grid tempo (median IBI, or `60/bpm` when the
 * manifest tempo is known) — deliberately NOT a local rolling median. A local
 * reference slides along with a sustained error, so a whole region detected ~8%
 * off would look "normal" against its (equally-wrong) neighbours and never
 * flag. Against the global constant, every interval in that region lights up.
 *
 * Flag-only: this never edits the grid. It reports where to look (or that the
 * whole detection source is wrong and a different one should be tried).
 */

export interface BeatLike {
  time: number;
}

export interface StretchInterval {
  /** Index of the interval = index of its starting beat. */
  i: number;
  /** Start time of the interval (seconds). */
  time: number;
  /** Inter-beat interval (seconds). */
  ibi: number;
  /** Signed change vs the nominal beat: ibi/nominal − 1. +stretch / −compress. */
  relChange: number;
  /** 1-based bar number, only when an anchor is supplied (else undefined). */
  bar?: number;
}

export interface BeatQcResult {
  /** The stable reference beat length (seconds). */
  nominalIbi: number;
  /** 60 / nominalIbi. */
  bpm: number;
  /** How the reference was chosen. */
  reference: "bpm" | "median";
  /** Flag threshold (fraction, e.g. 0.05 = 5%). */
  threshold: number;
  /** Every interval, in order — the "go back later" record. */
  intervals: StretchInterval[];
  /** Just the intervals with |relChange| > threshold. */
  flags: StretchInterval[];
  /** flags.length. */
  flagCount: number;
}

export interface BeatQcOptions {
  /** Flag when |relChange| exceeds this fraction. Default 0.05 (5%). */
  threshold?: number;
  /** Known constant tempo; if set, nominal = 60/bpm. Else the grid median IBI. */
  bpm?: number;
  /** Downbeat time (seconds) for bar labelling. Omit to skip bar numbers. */
  anchor?: number;
  /** Beats per bar for bar labelling. Default 4. */
  beatsPerBar?: number;
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Analyse a beat grid for oversized stretches. Pure: no I/O, no mutation.
 */
export function analyzeBeatStretches(
  beats: BeatLike[],
  opts: BeatQcOptions = {},
): BeatQcResult {
  const threshold = opts.threshold ?? 0.05;
  const beatsPerBar = opts.beatsPerBar ?? 4;

  const ibis: number[] = [];
  for (let i = 1; i < beats.length; i++) ibis.push(beats[i].time - beats[i - 1].time);

  const reference: "bpm" | "median" = opts.bpm ? "bpm" : "median";
  const nominalIbi = opts.bpm ? 60 / opts.bpm : median(ibis);
  const bpm = 60 / nominalIbi;

  const intervals: StretchInterval[] = ibis.map((ibi, k) => {
    const time = beats[k].time;
    const interval: StretchInterval = {
      i: k,
      time,
      ibi,
      relChange: ibi / nominalIbi - 1,
    };
    if (opts.anchor !== undefined) {
      interval.bar = Math.floor((time - opts.anchor) / nominalIbi / beatsPerBar) + 1;
    }
    return interval;
  });

  const flags = intervals.filter((iv) => Math.abs(iv.relChange) > threshold);

  return {
    nominalIbi,
    bpm,
    reference,
    threshold,
    intervals,
    flags,
    flagCount: flags.length,
  };
}
