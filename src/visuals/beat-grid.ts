/**
 * Audio features on the song's beat grid, for visuals.
 *
 * `clickbait-audio features` measures a stem frame by frame in recording
 * seconds. Visuals follow the beat clock, so this moves those frames onto a
 * 16th-note grid through the recording curve (the same curve that places
 * lyrics), then scales each stem against its own loud passages so a quiet
 * vocal stem drives the picture as much as the drums do.
 */

import type { Curve } from "../core/curve.js";

/** What `clickbait-audio features` writes for one file. */
export interface FrameFeatures {
  fps: number;
  duration: number;
  rmsDb: number[];
  onset: number[];
  centroidHz: number[];
  lowDb: number[];
  midDb: number[];
  highDb: number[];
}

type Column = "rmsDb" | "onset" | "centroidHz" | "lowDb" | "midDb" | "highDb";
const COLUMNS: readonly Column[] = ["rmsDb", "onset", "centroidHz", "lowDb", "midDb", "highDb"];

/** Frame features in raw units, one value per step of the grid. */
export type GridFeatures = Record<Column, number[]> & {
  /** Beat of step 0. */
  startBeat: number;
  stepsPerBeat: number;
};

/** Grid features scaled to 0..1. */
export interface NormalFeatures {
  startBeat: number;
  stepsPerBeat: number;
  loud: number[];
  onset: number[];
  bright: number[];
  low: number[];
  mid: number[];
  high: number[];
}

/**
 * Move frames onto the beat grid. Step `k` is centered on beat
 * `startBeat + k / stepsPerBeat` and takes the frames within half a step of
 * it, so a hit a few milliseconds early still lands on its beat. Onset keeps
 * the strongest frame (a hit must not be averaged away); the rest average.
 */
export function framesToGrid(f: FrameFeatures, curve: Curve, stepsPerBeat = 4): GridFeatures {
  const n = f.onset.length;
  const startBeat = Math.floor(curve.toBeat(0) * stepsPerBeat) / stepsPerBeat;
  const steps = Math.ceil((curve.toBeat(f.duration) - startBeat) * stepsPerBeat) + 1;
  const stepOf = (i: number) => Math.round((curve.toBeat(i / f.fps) - startBeat) * stepsPerBeat);

  const sums = Object.fromEntries(COLUMNS.map((c) => [c, new Array<number>(steps).fill(0)])) as Record<Column, number[]>;
  const counts = new Array<number>(steps).fill(0);
  for (let i = 0; i < n; i++) {
    const s = stepOf(i);
    if (s < 0 || s >= steps) continue;
    counts[s]++;
    for (const c of COLUMNS) {
      sums[c][s] = c === "onset" ? Math.max(sums[c][s], f[c][i]) : sums[c][s] + f[c][i];
    }
  }

  const grid = { startBeat, stepsPerBeat } as GridFeatures;
  for (const c of COLUMNS) {
    grid[c] = sums[c].map((v, s) => {
      if (counts[s] > 0) return c === "onset" ? v : v / counts[s];
      // A step no frame fell in (a very fast tempo): take the nearest frame.
      const t = curve.toTime(startBeat + s / stepsPerBeat);
      const i = Math.min(n - 1, Math.max(0, Math.round(t * f.fps)));
      return f[c][i];
    });
  }
  return grid;
}

/** How far below a stem's loud passages its dB features reach zero. */
const DB_RANGE = 30;
/** Below this, a stem is silent whatever its own levels are. */
const SILENCE_DB = -60;
/** Brightness spans this centroid range on a log scale. */
const BRIGHT_LO_HZ = 100;
const BRIGHT_HI_HZ = 8000;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** The value at fraction `p` through the sorted values. */
function percentile(v: readonly number[], p: number): number {
  const sorted = [...v].sort((a, b) => a - b);
  return sorted[Math.floor(p * (sorted.length - 1))] ?? 0;
}

/** dB to 0..1: the stem's 95th percentile is 1, `DB_RANGE` below it is 0. */
function scaleDb(v: readonly number[]): number[] {
  const hi = percentile(v, 0.95);
  const lo = Math.max(hi - DB_RANGE, SILENCE_DB);
  if (hi <= lo) return v.map(() => 0);
  return v.map((x) => clamp01((x - lo) / (hi - lo)));
}

/** A linear feature to 0..1, with the stem's 95th percentile at 1. */
function scaleLinear(v: readonly number[]): number[] {
  const hi = percentile(v, 0.95);
  if (hi <= 0) return v.map(() => 0);
  return v.map((x) => clamp01(x / hi));
}

/**
 * Scale one stem's grid to 0..1. Loudness, onsets and bands are relative to
 * the stem's own 95th percentile, so a single huge hit doesn't flatten the
 * rest. Brightness is absolute, so a bright stem reads brighter than a dark one.
 */
export function normalizeGrid(g: GridFeatures): NormalFeatures {
  const lb = Math.log(BRIGHT_LO_HZ);
  const hb = Math.log(BRIGHT_HI_HZ);
  return {
    startBeat: g.startBeat,
    stepsPerBeat: g.stepsPerBeat,
    loud: scaleDb(g.rmsDb),
    onset: scaleLinear(g.onset),
    bright: g.centroidHz.map((hz) => (hz > 0 ? clamp01((Math.log(hz) - lb) / (hb - lb)) : 0)),
    low: scaleDb(g.lowDb),
    mid: scaleDb(g.midDb),
    high: scaleDb(g.highDb),
  };
}
