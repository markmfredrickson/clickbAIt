/**
 * Re-phase a detected beat grid by half a beat, onto the true hits.
 *
 * The DBN energy tracker can lock onto the offbeat eighths (hi-hat "&"s), a
 * half-beat early of the kick/snare (see last-nite). The grid's SPACING is
 * right; only its phase is off — and offbeat pins mean offbeat stretch
 * markers, which are awkward to nudge in REAPER. This shifts every beat to
 * the midpoint of its neighbors (+ an extrapolated leading beat half a period
 * before the first pin), snapping each new position to the strongest analysis
 * onset within tolerance so pins land on real hits, not interpolated guesses.
 *
 * Bookkeeping: output beat i sits half a beat EARLIER in song position than
 * input beat i, so the manifest's `startBeat` drops by 0.5 (x.5-phase pins
 * with startBeat 0.5 become integer-phase pins with startBeat 0).
 */

import type { DetectedBeat, ChainOptions } from "./intro-pins.js";

export function rephaseBeats(
  pins: readonly DetectedBeat[],
  onsets: readonly DetectedBeat[],
  opts: ChainOptions = {},
): DetectedBeat[] {
  const { tolerance = 0.08, minStrength = 0.05 } = opts;
  if (pins.length < 2) return [];

  const usable = onsets.filter((o) => o.strength >= minStrength);
  const snap = (t: number): DetectedBeat => {
    let best: DetectedBeat | undefined;
    for (const o of usable) {
      if (Math.abs(o.time - t) > tolerance) continue;
      if (!best || o.strength > best.strength) best = o;
    }
    return best ?? { time: t, strength: 0 };
  };

  const out: DetectedBeat[] = [];
  // Leading beat: half a period before the first pin (the downbeat a
  // half-early grid never emitted), snapped to a real onset when one is there.
  out.push(snap(pins[0].time - (pins[1].time - pins[0].time) / 2));
  for (let i = 0; i + 1 < pins.length; i++) {
    out.push(snap((pins[i].time + pins[i + 1].time) / 2));
  }
  // Snapping must never reorder the grid.
  for (let i = 1; i < out.length; i++) {
    if (out[i].time <= out[i - 1].time) out[i] = { time: (pins[i - 1].time + pins[i].time) / 2, strength: 0 };
  }
  return out;
}
