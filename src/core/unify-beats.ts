/**
 * Unify two beat-detection passes into one grid.
 *
 * We run the DBN tracker twice (see the `beats` command): once on the drum
 * stem with energy activation, which is tight where the drums play but invents
 * a pulse where they don't, and once on the full mix with spectral-flux
 * activation, which keeps a pulse through drum-silent passages but jitters.
 *
 * The drum beats are used everywhere except inside the drum stem's silences
 * (`drum-silence.ts`). A silence is filled at a constant tempo: the full mix
 * says how many beats it holds, and they are spaced evenly between the drum
 * beats on either side. A silent intro or ending, with a drum beat on one side
 * only, gets the constant tempo that best fits the full-mix beats, through
 * that drum beat. The full-mix beats are first shifted by their median offset
 * from the drum beats.
 *
 * When a gap's full-mix count disagrees with the tempo around it (the full
 * mix missed or doubled a beat), the count that tempo gives is used and
 * `onNote` reports the gap, so it can be checked by ear.
 */

export interface DetectedBeat {
  time: number;
  strength: number;
}

export interface UnifyOptions {
  /** Called with a message for each gap whose full-mix count was overruled. */
  onNote?: (message: string) => void;
}

const byTime = (a: DetectedBeat, b: DetectedBeat) => a.time - b.time;

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Median of consecutive gaps, or `undefined` for fewer than two beats. */
function medianIbi(beats: DetectedBeat[]): number | undefined {
  return median(beats.slice(1).map((b, i) => b.time - beats[i].time));
}

const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

export function unifyBeats(
  fullMix: DetectedBeat[],
  drum: DetectedBeat[],
  silences: Array<[number, number]>,
  opts: UnifyOptions = {},
): DetectedBeat[] {
  const full = [...fullMix].sort(byTime);
  const drums = [...drum].sort(byTime);
  if (drums.length === 0) return full;
  if (full.length === 0) return drums;

  const inSilence = (t: number) => silences.some(([a, b]) => t >= a && t < b);
  const kept = drums.filter((b) => !inSilence(b.time));
  const ibi = medianIbi(kept) ?? medianIbi(drums) ?? medianIbi(full)!;

  // Full-mix offset from the drums, measured where both passes have a beat.
  const offsets: number[] = [];
  for (const d of kept) {
    let best = Infinity;
    for (const f of full) if (Math.abs(f.time - d.time) < Math.abs(best)) best = f.time - d.time;
    if (Math.abs(best) < 0.25 * ibi) offsets.push(best);
  }
  const shift = median(offsets) ?? 0;
  const shifted = full.map((b) => ({ ...b, time: b.time - shift }));

  const out: DetectedBeat[] = [...kept];
  for (const [a, b] of silences) {
    const before = [...kept].reverse().find((d) => d.time < a);
    const after = kept.find((d) => d.time >= b);
    // The full-mix beats that belong to the gap: inside the silence (with a
    // beat of slack at each edge), and clear of the drum beats that bound it.
    const lo = Math.max(a - ibi, before ? before.time + ibi / 2 : -Infinity);
    const hi = Math.min(b + ibi, after ? after.time - ibi / 2 : Infinity);
    const inner = shifted.filter((f) => f.time > lo && f.time < hi);
    const strength = median(inner.map((f) => f.strength)) ?? 0;

    if (before && after) {
      // Local tempo around the gap, for the count check: from the full mix,
      // which has beats everywhere (the drum beats near a gap can be sparse).
      const near = shifted.filter((f) => f.time > before.time - 8 * ibi && f.time < after.time + 8 * ibi);
      const localIbi = medianIbi(near) ?? ibi;
      const expected = (after.time - before.time) / localIbi;
      let n = inner.length + 1;
      if (Math.abs(n - expected) >= 0.5) {
        n = Math.max(1, Math.round(expected));
        opts.onNote?.(
          `drum gap ${clock(before.time)}-${clock(after.time)}: the full mix has ${inner.length + 1} beats, ` +
            `the tempo around it says ${n}; using ${n}, check by ear`,
        );
      }
      const step = (after.time - before.time) / n;
      for (let k = 1; k < n; k++) out.push({ time: before.time + k * step, strength });
    } else if (before || after) {
      // One drum anchor: the constant tempo that best fits the full-mix beats,
      // through the anchor (least squares on the beat index).
      const anchor = (before ?? after)!.time;
      const dir = before ? 1 : -1;
      const ordered = [...inner].sort((p, q) => dir * (p.time - q.time));
      let num = 0, den = 0;
      ordered.forEach((f, i) => { num += (i + 1) * dir * (f.time - anchor); den += (i + 1) ** 2; });
      const step = den > 0 ? num / den : ibi;
      ordered.forEach((_, i) => out.push({ time: anchor + dir * (i + 1) * step, strength }));
    } else {
      out.push(...inner);
    }
  }
  return out.sort(byTime);
}
