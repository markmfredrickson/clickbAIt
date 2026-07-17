/**
 * Warble-smoothing for a detected beat curve.
 *
 * A stretch warble is a curve vertex bulging off the constant-tempo line: two
 * adjacent segments whose slopes jerk in opposite directions (REAPER stretches
 * one bar up and the next down). We remove it by nudging that shared vertex's
 * BEAT coordinate toward the diagonal while keeping its detected TIME — the audio
 * onset is real, it was just mis-labeled a hair off the beat (flams/grace notes
 * anchor early). Only interior vertices move, so both endpoints stay fixed: no
 * drift, no retiming.
 *
 * With times fixed, nudging a beat only changes the RELATIVE slopes of its two
 * segments, so the knob is the max adjacent-segment slope change — the "kink",
 * i.e. the local tempo *change* between markers — not absolute tempo. That's
 * exactly the warble; a sustained tempo offset isn't a kink and is left alone.
 */

import { expandBeatMap } from "./beat-map.js";
import { Curve } from "./curve.js";
import type { BeatMap } from "../manifest.js";

export interface BeatPoint {
  /** Song-beat (may be fractional after nudging). */
  b: number;
  /** Source-time in seconds (kept fixed — trusted detection). */
  t: number;
}

export interface SmoothOptions {
  bpm: number;
  /** Max allowed change in normalized slope between adjacent segments (the kink).
   *  0.04 = adjacent markers' tempo may differ by ≤4%. */
  maxKink?: number;
  /** Monotonic floor on normalized slope, so time stays strictly increasing. */
  minSlope?: number;
  /** Max relaxation passes (coupled vertices need a few). */
  maxPasses?: number;
}

export interface SmoothResult {
  points: BeatPoint[];
  /** Largest |adjacent-slope change| before / after, for QC. */
  maxKinkBefore: number;
  maxKinkAfter: number;
}

/**
 * Nudge interior beats (times fixed) so no two adjacent segments' slopes differ
 * by more than `maxKink`. Endpoints are never moved. Idempotent.
 */
export function smoothBeatCurve(points: readonly BeatPoint[], opts: SmoothOptions): SmoothResult {
  const { bpm, maxKink = 0.04, minSlope = 0.1, maxPasses = 50 } = opts;
  const tau = 60 / bpm;
  const b = points.map((p) => p.b);
  const t = points.map((p) => p.t);
  const n = points.length;

  // Normalized slope of segment i (from point i-1 to i): 1.0 = on the click.
  const slope = (i: number) => (t[i] - t[i - 1]) / ((b[i] - b[i - 1]) * tau);
  const worstKink = () => {
    let m = 0;
    for (let i = 1; i < n - 1; i++) m = Math.max(m, Math.abs(slope(i + 1) - slope(i)));
    return m;
  };

  const before = n >= 3 ? worstKink() : 0;

  for (let pass = 0; pass < maxPasses && n >= 3; pass++) {
    let moved = false;
    for (let i = 1; i < n - 1; i++) {
      const kink = slope(i + 1) - slope(i);
      if (Math.abs(kink) <= maxKink) continue;

      const bPrev = b[i - 1], bNext = b[i + 1];
      const dtL = t[i] - t[i - 1], dtR = t[i + 1] - t[i];
      // f(x) = slopeRight(x) - slopeLeft(x); monotonically increasing in x.
      const f = (x: number) => dtR / ((bNext - x) * tau) - dtL / ((x - bPrev) * tau);
      const target = kink > 0 ? maxKink : -maxKink;

      // Keep both slopes >= minSlope (monotonic time), inside (bPrev, bNext).
      const lo = Math.max(bPrev + 1e-6, bNext - dtR / (minSlope * tau));
      const hi = Math.min(bNext - 1e-6, bPrev + dtL / (minSlope * tau));
      if (lo >= hi) continue; // no feasible nudge

      let xlo = lo, xhi = hi;
      for (let it = 0; it < 60; it++) {
        const xm = (xlo + xhi) / 2;
        if (f(xm) < target) xlo = xm;
        else xhi = xm;
      }
      const x = (xlo + xhi) / 2;
      if (Math.abs(x - b[i]) > 1e-9) { b[i] = x; moved = true; }
    }
    if (!moved) break;
  }

  return {
    points: b.map((bb, i) => ({ b: bb, t: t[i] })),
    maxKinkBefore: before,
    maxKinkAfter: n >= 3 ? worstKink() : 0,
  };
}

/**
 * Smooth a whole beat-map's warble at DOWNBEAT granularity (the stretch-marker
 * level), returning a new beat-map with the same per-beat structure and times
 * resampled off the smoothed curve. Only the downbeats' spacing is regularized;
 * sub-beat points ride the (piecewise-linear) smoothed curve, which is what
 * REAPER already does between downbeat markers — so the audio result is exactly
 * the smoothing, no more.
 */
export function smoothBeatMap(
  beatMap: BeatMap,
  bpm: number,
  beatsPerBar: number,
  maxKink = 0.04,
): { beatMap: BeatMap; maxKinkBefore: number; maxKinkAfter: number } {
  const expanded = expandBeatMap(beatMap); // [{ b, t }] sorted
  const b0 = expanded[0].b;
  const downbeats = expanded
    .filter((p) => Math.round(p.b - b0) % beatsPerBar === 0)
    .map((p) => ({ b: p.b, t: p.t }));

  const { points, maxKinkBefore, maxKinkAfter } = smoothBeatCurve(downbeats, { bpm, maxKink });
  const curve = new Curve(points.map((p) => ({ t: p.t, b: p.b })));
  const times = expanded.map((p) => +curve.toTime(p.b).toFixed(6));

  // Preserve the original shape: a single dense run stays a run; anything else
  // (pins / multiple runs) round-trips as explicit pins at each expanded beat.
  const dense = beatMap.length === 1 && "times" in beatMap[0];
  const out: BeatMap = dense
    ? [{ startBeat: b0, times }]
    : expanded.map((p, i) => ({ beat: p.b, t: times[i] }));

  return { beatMap: out, maxKinkBefore, maxKinkAfter };
}
