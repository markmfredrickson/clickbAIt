/**
 * Curve — the bidirectional map between time and beat.
 *
 * A song is a strictly monotonic curve in `(time, beat)` space. Time (seconds)
 * and beat are **co-equal axes**: neither is derived from the other, and a
 * built event always carries both. The curve is the single map that resolves
 * one coordinate from the other, in either direction, with round-trip
 * consistency (`toBeat(toTime(b)) ≈ b`).
 *
 * Representation: an ordered list of `(t, b)` anchors, strictly increasing in
 * BOTH axes, with linear interpolation between consecutive anchors. Past the
 * ends, the curve extrapolates along an explicit leading/trailing slope
 * (defaulting to the first/last interior segment's slope).
 *
 * This generalizes the old piecewise-constant `TempoMap` (`tempo.ts`): a
 * `{beat, bpm}` map is exactly a piecewise-LINEAR `(t, b)` curve whose segment
 * slopes are the BPMs. `Curve.fromTempoMap` is the lossless bridge, used as a
 * regression guard while consumers migrate off `beatToSeconds`/`secondsToBeat`.
 */

import { beatToSeconds, type TempoPoint } from "./tempo.js";

export interface Anchor {
  /** Time in seconds. */
  t: number;
  /** Beat (quarter-note count from beat 0). */
  b: number;
}

/** Slope of a curve segment, in beats per second. */
function bps(a: Anchor, b: Anchor): number {
  return (b.b - a.b) / (b.t - a.t);
}

export interface ConstantBpmOptions {
  /** Seconds at beat 0 (pre-roll / count-in offset). Default 0. */
  t0?: number;
}

export interface CurveOptions {
  /**
   * Beats per second to use when extrapolating before the first anchor.
   * Defaults to the first interior segment's slope.
   */
  leadingBps?: number;
  /**
   * Beats per second to use when extrapolating after the last anchor.
   * Defaults to the last interior segment's slope.
   */
  trailingBps?: number;
}

export class Curve {
  readonly anchors: readonly Anchor[];
  private readonly leadingBps: number;
  private readonly trailingBps: number;

  constructor(anchors: readonly Anchor[], opts: CurveOptions = {}) {
    if (anchors.length < 2 && opts.leadingBps === undefined) {
      throw new Error(
        "Curve requires at least two anchors (or an explicit slope) to define a map",
      );
    }
    // Validate strict monotonicity in both axes. Ambiguous resolution is a
    // bug, not a silent result — a flat or reversed segment means one beat maps
    // to many times (or vice versa), which has no well-defined inverse.
    for (let i = 1; i < anchors.length; i++) {
      const prev = anchors[i - 1];
      const cur = anchors[i];
      if (cur.t <= prev.t) {
        throw new Error(
          `Curve anchors must strictly increase in time: t=${prev.t} then t=${cur.t} at index ${i}`,
        );
      }
      if (cur.b <= prev.b) {
        throw new Error(
          `Curve anchors must strictly increase in beat: b=${prev.b} then b=${cur.b} at index ${i}`,
        );
      }
    }
    this.anchors = anchors;
    const first = anchors[0];
    const second = anchors[1];
    const last = anchors[anchors.length - 1];
    const penult = anchors[anchors.length - 2];
    this.leadingBps = opts.leadingBps ?? bps(first, second);
    this.trailingBps = opts.trailingBps ?? bps(penult, last);
  }

  /** A constant-tempo curve: two anchors with `bpm`-derived slope. */
  static constantBpm(bpm: number, opts: ConstantBpmOptions = {}): Curve {
    const t0 = opts.t0 ?? 0;
    const beatsPerSec = bpm / 60;
    // Two anchors one beat apart fully define the constant slope; extrapolation
    // (defaulting to this segment's slope) covers the rest of the song.
    return new Curve([
      { t: t0, b: 0 },
      { t: t0 + 1 / beatsPerSec, b: 1 },
    ]);
  }

  /**
   * Lossless bridge from a piecewise-constant `TempoMap`. The segment between
   * tempo points i and i+1 takes point i's bpm; the trailing slope is the last
   * point's bpm (which applies "from that beat forward"). Matches
   * `beatToSeconds`/`secondsToBeat` exactly.
   */
  static fromTempoMap(map: readonly TempoPoint[]): Curve {
    if (map.length === 0) return Curve.constantBpm(120);
    if (map.length === 1) return Curve.constantBpm(map[0].bpm);

    const anchors: Anchor[] = map.map((pt) => ({
      b: pt.beat,
      t: beatToSeconds(pt.beat, map),
    }));
    const tailBps = map[map.length - 1].bpm / 60;
    const leadBps = map[0].bpm / 60;
    return new Curve(anchors, { leadingBps: leadBps, trailingBps: tailBps });
  }

  /** Seconds at beat `b`. */
  toTime(b: number): number {
    const a = this.anchors;
    if (b <= a[0].b) {
      return a[0].t + (b - a[0].b) / this.leadingBps;
    }
    const lastIdx = a.length - 1;
    if (b >= a[lastIdx].b) {
      return a[lastIdx].t + (b - a[lastIdx].b) / this.trailingBps;
    }
    const i = this.segmentByBeat(b);
    if (b === a[i].b) return a[i].t; // exactness at anchors
    const slope = bps(a[i], a[i + 1]);
    return a[i].t + (b - a[i].b) / slope;
  }

  /** Beat at time `t` (seconds). */
  toBeat(t: number): number {
    const a = this.anchors;
    if (t <= a[0].t) {
      return a[0].b + (t - a[0].t) * this.leadingBps;
    }
    const lastIdx = a.length - 1;
    if (t >= a[lastIdx].t) {
      return a[lastIdx].b + (t - a[lastIdx].t) * this.trailingBps;
    }
    const i = this.segmentByTime(t);
    if (t === a[i].t) return a[i].b; // exactness at anchors
    const slope = bps(a[i], a[i + 1]);
    return a[i].b + (t - a[i].t) * slope;
  }

  /** Index `i` such that anchors[i].b <= b < anchors[i+1].b (b interior). */
  private segmentByBeat(b: number): number {
    const a = this.anchors;
    let lo = 0;
    let hi = a.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (a[mid].b <= b) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** Index `i` such that anchors[i].t <= t < anchors[i+1].t (t interior). */
  private segmentByTime(t: number): number {
    const a = this.anchors;
    let lo = 0;
    let hi = a.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (a[mid].t <= t) lo = mid;
      else hi = mid;
    }
    return lo;
  }
}
