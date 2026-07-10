/**
 * Unify two beat-detection passes into one grid.
 *
 * We run the DBN tracker twice (see the `beats` command): once on the full mix
 * with spectral-flux activation — which keeps a plausible pulse through
 * drum-silent passages (intros, breakdowns) — and once on the drum stem with
 * energy activation, which is tight where the drums actually play but
 * hallucinates a pulse where they don't. This merges them into the single grid
 * the manifest's `beatMap` is built from.
 *
 * v1 heuristic (deliberately simple; the parked drum-beat-model work will
 * refine it): the drum stem is authoritative across the span where it has
 * CONFIDENT beats — from the first strong drum beat to the last — and the full
 * mix fills everything outside that span (the drum-silent intro/outro). At the
 * seam we drop whichever side's beat would double up, keeping the drum-side
 * beat. This models the common case (a drum-silent intro, then drums in for the
 * rest); a mid-song drum breakout is treated as still "inside" the span and is
 * future work.
 */

export interface DetectedBeat {
  time: number;
  strength: number;
}

export interface UnifyOptions {
  /** A drum beat counts as "confident" when its strength is at least this
   *  fraction of the loudest drum beat. Default 0.5. */
  strongThreshold?: number;
  /** Two beats closer than `seamFactor × median-IBI` are a collision at the
   *  seam; the drum-side one is kept. Default 0.5. */
  seamFactor?: number;
}

const byTime = (a: DetectedBeat, b: DetectedBeat) => a.time - b.time;

/** Median of consecutive gaps, or `undefined` for fewer than two beats. */
function medianIbi(beats: DetectedBeat[]): number | undefined {
  if (beats.length < 2) return undefined;
  const gaps = beats.slice(1).map((b, i) => b.time - beats[i].time).sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
}

export function unifyBeats(
  fullMix: DetectedBeat[],
  drum: DetectedBeat[],
  opts: UnifyOptions = {},
): DetectedBeat[] {
  const full = [...fullMix].sort(byTime);
  const drums = [...drum].sort(byTime);
  if (drums.length === 0) return full;
  if (full.length === 0) return drums;

  const strongThreshold = opts.strongThreshold ?? 0.5;
  const seamFactor = opts.seamFactor ?? 0.5;

  const maxStrength = Math.max(...drums.map((b) => b.strength));
  const thr = strongThreshold * maxStrength;
  const strong = drums.filter((b) => b.strength >= thr);
  if (strong.length === 0) return full; // no confident drums anywhere → full mix

  const spanStart = strong[0].time;
  const spanEnd = strong[strong.length - 1].time;
  const inSpan = (t: number) => t >= spanStart && t <= spanEnd;

  // Drum beats define the grid inside the span; full-mix beats fill outside it.
  const inside = drums.filter((b) => inSpan(b.time));
  const outside = full.filter((b) => !inSpan(b.time));
  const merged = [...inside, ...outside].sort(byTime);

  const ibi = medianIbi(drums) ?? medianIbi(full) ?? Infinity;
  const minGap = seamFactor * ibi;

  // Drop seam collisions, preferring the drum-side (in-span) beat.
  const out: DetectedBeat[] = [];
  for (const b of merged) {
    const last = out[out.length - 1];
    if (last && b.time - last.time < minGap) {
      if (inSpan(b.time) && !inSpan(last.time)) out[out.length - 1] = b; // drum wins
      // otherwise keep `last`, drop `b`
    } else {
      out.push(b);
    }
  }
  return out;
}
