/**
 * The recording beat-map: `source-time ↔ song-beat`, authored inline in the
 * manifest (see `BeatMap` in manifest.ts). This module turns that authored form
 * into the two things the pipeline needs:
 *
 *   - `expandBeatMap` — flatten pins + strided runs into sorted control points.
 *   - `beatMapCurve`  — a `Curve` through those points, extrapolating at the
 *     song BPM past the outermost pin.
 *
 * The control points double as the recording's stretch markers: a marker per
 * point, linear between. So point *density* is the whole story — dense follows
 * the recording's micro-timing, a gap is a deliberate linear stretch (a rubato
 * intro compressed into fewer bars), a strided run pins downbeats and lets the
 * feel float. There is no separate "stride" or "linear" mode; it's all density.
 */

import { Curve, type Anchor } from "./curve.js";
import type { BeatMap } from "../manifest.js";

/**
 * Flatten a beat-map to sorted `(beat, source-time)` control points. A pin is
 * one point; a run expands to `startBeat + i·stride` at `times[i]`. Sorted by
 * beat (which, for a valid map, is the same order as by time).
 */
export function expandBeatMap(beatMap: BeatMap): Anchor[] {
  const pts: Anchor[] = [];
  for (const e of beatMap) {
    if ("beat" in e) {
      pts.push({ b: e.beat, t: e.t });
    } else {
      const stride = e.stride ?? 1;
      e.times.forEach((t, i) => pts.push({ b: e.startBeat + i * stride, t }));
    }
  }
  pts.sort((a, b) => a.b - b.b);
  return pts;
}

/**
 * The recording curve (source-time ↔ song-beat): piecewise-linear through the
 * control points, extrapolating at the constant song BPM before the first pin
 * and after the last. Strict monotonicity (in both axes) is enforced by `Curve`
 * — a backtracking or duplicated point is a build error.
 */
export function beatMapCurve(beatMap: BeatMap, bpm: number): Curve {
  const pts = expandBeatMap(beatMap);
  const bps = bpm / 60;
  return new Curve(pts, { leadingBps: bps, trailingBps: bps });
}

/**
 * Per-beat source times for the stretch-marker engine (`beatsToStretchMarkers`),
 * plus the beat number of the first entry (`offset`).
 *
 * The engine expects one source time per consecutive song beat, indexed from
 * `offset`. So we walk integer beats from the first control point to the last
 * and read the curve at each: at a pinned beat that returns its exact source
 * time (the curve passes through it → dense runs reproduce the detected beats
 * exactly); in a gap it returns the linear interpolation (a deliberate stretch,
 * e.g. a compressed rubato intro). `offset` may be fractional (a pickup anchor),
 * in which case the beats step by 1 from that fractional start — same as the
 * old detected-beats-plus-offset behavior.
 */
export function beatMapToBeats(
  beatMap: BeatMap,
  bpm: number,
): { beats: { time: number }[]; offset: number } {
  const pts = expandBeatMap(beatMap);
  const curve = beatMapCurve(beatMap, bpm);
  const firstB = pts[0].b;
  const lastB = pts[pts.length - 1].b;
  const n = Math.round(lastB - firstB) + 1;
  const beats = Array.from({ length: n }, (_, i) => ({ time: curve.toTime(firstB + i) }));
  return { beats, offset: firstB };
}
