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
 * v2 heuristic (deliberately simple; the parked drum-beat-model work will
 * refine it): the drum stem is authoritative across the span where it has
 * CONFIDENT beats — from the first strong drum beat to the last — EXCEPT inside
 * "holes": gaps between consecutive strong drum beats too large to be normal (a
 * mid-song drum breakdown, where the tracker hallucinates a fast pulse through
 * the silence and would cram in extra beats → a within-bar phase slip). The full
 * mix fills outside the span AND inside holes. At every seam we drop whichever
 * side's beat would double up, keeping the drum-side beat.
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
  /** A gap between consecutive STRONG drum beats larger than `holeFactor ×
   *  median-strong-IBI` is a drum-silent hole (a breakdown) filled from the full
   *  mix instead of the tracker's hallucinated pulse. Default 1.75. */
  holeFactor?: number;
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
  const holeFactor = opts.holeFactor ?? 1.75;

  const maxStrength = Math.max(...drums.map((b) => b.strength));
  const thr = strongThreshold * maxStrength;
  const strong = drums.filter((b) => b.strength >= thr);
  if (strong.length === 0) return full; // no confident drums anywhere → full mix

  const spanStart = strong[0].time;
  const spanEnd = strong[strong.length - 1].time;
  const inSpan = (t: number) => t >= spanStart && t <= spanEnd;

  // Holes: gaps between consecutive STRONG drum beats too large to be normal — a
  // mid-song drum breakdown, where the drum tracker hallucinates a pulse through
  // the silence. Fill these from the full mix, not the drum stem.
  const strongIbi = medianIbi(strong) ?? Infinity;
  const holes: Array<[number, number]> = [];
  for (let i = 1; i < strong.length; i++) {
    if (strong[i].time - strong[i - 1].time > holeFactor * strongIbi) {
      holes.push([strong[i - 1].time, strong[i].time]);
    }
  }
  const inHole = (t: number) => holes.some(([a, b]) => t > a && t < b);
  const drumCovered = (t: number) => inSpan(t) && !inHole(t);

  // Drum beats where they're covering; full mix outside the span AND in holes.
  type Tagged = DetectedBeat & { _drum: boolean };
  const inside: Tagged[] = drums.filter((b) => drumCovered(b.time)).map((b) => ({ ...b, _drum: true }));
  const filler: Tagged[] = full.filter((b) => !drumCovered(b.time)).map((b) => ({ ...b, _drum: false }));
  const merged = [...inside, ...filler].sort(byTime);

  const ibi = medianIbi(drums) ?? medianIbi(full) ?? Infinity;
  const minGap = seamFactor * ibi;

  // Drop seam collisions, preferring the drum-side beat.
  const out: Tagged[] = [];
  for (const b of merged) {
    const last = out[out.length - 1];
    if (last && b.time - last.time < minGap) {
      if (b._drum && !last._drum) out[out.length - 1] = b; // drum wins
      // otherwise keep `last`, drop `b`
    } else {
      out.push(b);
    }
  }
  return out.map(({ time, strength }) => ({ time, strength }));
}
