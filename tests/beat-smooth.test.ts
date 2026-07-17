import { describe, it, expect } from "vitest";
import { smoothBeatCurve, smoothBeatMap, type BeatPoint } from "../src/core/beat-smooth.js";
import { expandBeatMap } from "../src/core/beat-map.js";
import type { BeatMap } from "../src/manifest.js";

const BPM = 120; // tau = 0.5s/beat
const TAU = 0.5;

// Build downbeat points at beats 0,4,8,... from a list of per-segment slopes
// (normalized: 1.0 = on the click). times are fixed/trusted.
function fromSlopes(slopes: number[]): BeatPoint[] {
  const pts: BeatPoint[] = [{ b: 0, t: 0 }];
  let t = 0;
  slopes.forEach((s, i) => {
    t += s * 4 * TAU; // 4 beats per downbeat segment
    pts.push({ b: (i + 1) * 4, t });
  });
  return pts;
}
const times = (p: BeatPoint[]) => p.map((x) => +x.t.toFixed(9));
const worstKink = (p: BeatPoint[]) => {
  let m = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const sL = (p[i].t - p[i - 1].t) / ((p[i].b - p[i - 1].b) * TAU);
    const sR = (p[i + 1].t - p[i].t) / ((p[i + 1].b - p[i].b) * TAU);
    m = Math.max(m, Math.abs(sR - sL));
  }
  return m;
};

describe("smoothBeatCurve", () => {
  it("leaves a constant-tempo curve untouched", () => {
    const pts = fromSlopes([1, 1, 1, 1]);
    const { points } = smoothBeatCurve(pts, { bpm: BPM, maxKink: 0.04 });
    expect(points).toEqual(pts);
  });

  it("leaves a gradual ramp (each kink <= maxKink) untouched", () => {
    const pts = fromSlopes([1.0, 1.03, 1.06, 1.09]); // 3% kinks, bound 4%
    const { points, maxKinkAfter } = smoothBeatCurve(pts, { bpm: BPM, maxKink: 0.04 });
    expect(points).toEqual(pts);
    expect(maxKinkAfter).toBeLessThanOrEqual(0.04 + 1e-9);
  });

  it("removes a warble down to maxKink, keeping times and endpoints", () => {
    // YCHL-shaped: rush then drag then back.
    const pts = fromSlopes([1.0, 0.955, 1.061, 1.0]);
    const before = worstKink(pts);
    expect(before).toBeGreaterThan(0.1); // ~10.5% jerk
    const { points, maxKinkBefore, maxKinkAfter } = smoothBeatCurve(pts, { bpm: BPM, maxKink: 0.04 });

    expect(maxKinkBefore).toBeCloseTo(before, 6);
    expect(maxKinkAfter).toBeLessThanOrEqual(0.04 + 1e-6); // warble tamed
    expect(times(points)).toEqual(times(pts)); // times never change
    expect(points[0]).toEqual(pts[0]); // first endpoint fixed
    expect(points.at(-1)).toEqual(pts.at(-1)); // last endpoint fixed
    // beats strictly increasing (monotone)
    for (let i = 1; i < points.length; i++) expect(points[i].b).toBeGreaterThan(points[i - 1].b);
    // some interior beat actually moved off its integer
    expect(points.slice(1, -1).some((p, i) => Math.abs(p.b - pts[i + 1].b) > 1e-6)).toBe(true);
  });

  it("keeps slopes positive on a hard spike (minSlope floor)", () => {
    const pts = fromSlopes([1.0, 0.2, 1.8, 1.0]); // violent warble
    const { points } = smoothBeatCurve(pts, { bpm: BPM, maxKink: 0.05, minSlope: 0.25 });
    for (let i = 1; i < points.length; i++) {
      const s = (points[i].t - points[i - 1].t) / ((points[i].b - points[i - 1].b) * TAU);
      expect(s).toBeGreaterThanOrEqual(0.25 - 1e-6);
    }
  });

  it("is idempotent", () => {
    const pts = fromSlopes([1.0, 0.955, 1.061, 1.0, 0.97, 1.05]);
    const once = smoothBeatCurve(pts, { bpm: BPM, maxKink: 0.04 }).points;
    const twice = smoothBeatCurve(once, { bpm: BPM, maxKink: 0.04 }).points;
    expect(times(twice)).toEqual(times(once));
    twice.forEach((p, i) => expect(p.b).toBeCloseTo(once[i].b, 6));
  });

  it("no-ops on <3 points (nothing to smooth)", () => {
    const pts = [{ b: 0, t: 0 }, { b: 4, t: 2 }];
    const { points, maxKinkAfter } = smoothBeatCurve(pts, { bpm: BPM });
    expect(points).toEqual(pts);
    expect(maxKinkAfter).toBe(0);
  });
});

describe("smoothBeatMap", () => {
  // A dense per-beat run (4/4, 120 BPM) with a downbeat warble around beat 8.
  // Per-beat times = beat·TAU except we push beat 8 early to make bars 4-8 rush
  // and 8-12 drag (the YCHL shape at downbeat granularity).
  function warbleMap(): BeatMap {
    const times: number[] = [];
    for (let b = 0; b <= 20; b++) {
      let t = b * TAU;
      if (b === 8) t -= 0.09; // shove downbeat 8 early -> rush then drag
      times.push(+t.toFixed(6));
    }
    return [{ startBeat: 0, times }];
  }

  it("tames the downbeat kink and keeps the dense-run shape", () => {
    const map = warbleMap();
    const { beatMap, maxKinkBefore, maxKinkAfter } = smoothBeatMap(map, BPM, 4, 0.04);
    expect(maxKinkBefore).toBeGreaterThan(0.04);
    expect(maxKinkAfter).toBeLessThanOrEqual(0.04 + 1e-6);
    // still a single dense run over the same beats
    expect(beatMap).toHaveLength(1);
    expect("times" in beatMap[0]).toBe(true);
    const pts = expandBeatMap(beatMap);
    expect(pts.map((p) => p.b)).toEqual(expandBeatMap(map).map((p) => p.b)); // same beats
  });

  it("leaves a clean map unchanged", () => {
    const times = Array.from({ length: 17 }, (_, b) => +(b * TAU).toFixed(6));
    const map: BeatMap = [{ startBeat: 0, times }];
    const { beatMap, maxKinkAfter } = smoothBeatMap(map, BPM, 4, 0.04);
    expect(beatMap).toEqual(map);
    expect(maxKinkAfter).toBeLessThanOrEqual(1e-9);
  });
});
