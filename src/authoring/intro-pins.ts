/**
 * Auto-pin a late-instrument intro: when drums enter late, beat detection runs
 * from the drum entry (`beats --start`) and the bars before it have no pins —
 * the grid back-extrapolates at constant tempo and a human intro drifts
 * subtly against the click. This derives intro pins from evidence instead of
 * by hand: walk BACKWARD from the first detected beat in steps of the grid's
 * beat period, snapping each step to the nearest strong full-mix analysis
 * onset. Where the music stops offering onsets (leading silence), the chain
 * stops — no unevidenced pins.
 *
 * The pins keep the detected grid's beat *phase* (each pin is one period
 * before the next), so the manifest's `startBeat` bookkeeping is simple:
 * first detected beat was song beat B → after prepending N pins,
 * `startBeat = B - N`.
 */

export interface DetectedBeat {
  time: number;
  strength: number;
}

export interface ChainOptions {
  /** Max |onset - expected| in seconds to accept an onset as the pin. */
  tolerance?: number;
  /** Onsets weaker than this are noise, never pins. */
  minStrength?: number;
}

/**
 * Pins for the region before `detected[0]`, ascending. `onsets` is the
 * full-mix analysis onset list (times + strengths).
 */
export function chainIntroPins(
  detected: readonly DetectedBeat[],
  onsets: readonly DetectedBeat[],
  opts: ChainOptions = {},
): DetectedBeat[] {
  const { tolerance = 0.15, minStrength = 0.05 } = opts;
  if (detected.length < 2 || onsets.length === 0) return [];

  // Beat period from the detected grid (median interval — robust to a stray
  // long/short interval at a fill).
  const intervals = detected
    .slice(1)
    .map((b, i) => b.time - detected[i].time)
    .sort((a, b) => a - b);
  const period = intervals[Math.floor(intervals.length / 2)];

  const usable = onsets.filter((o) => o.strength >= minStrength);
  const pins: DetectedBeat[] = [];
  let expected = detected[0].time - period;
  for (;;) {
    // Among onsets within tolerance, STRENGTH wins (proximity only breaks
    // ties): a ghost note or flam can sit nearer the rigid expectation than
    // the real hit, and the real hit is the beat.
    let best: DetectedBeat | undefined;
    for (const o of usable) {
      if (Math.abs(o.time - expected) > tolerance) continue;
      if (
        !best ||
        o.strength > best.strength ||
        (o.strength === best.strength && Math.abs(o.time - expected) < Math.abs(best.time - expected))
      ) {
        best = o;
      }
    }
    if (!best) break; // leading silence (or a hole) — stop, don't invent pins
    pins.unshift(best);
    expected = best.time - period;
  }
  return pins;
}
