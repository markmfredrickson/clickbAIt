import { describe, expect, it } from "vitest";
import { Curve } from "../../src/core/curve.js";
import { framesToGrid, normalizeGrid, type FrameFeatures } from "../../src/visuals/beat-grid.js";

const FPS = 100;

/** Flat frame features: quiet, no onsets, for `secs` seconds. */
function frames(secs: number, fill: Partial<Record<keyof FrameFeatures, number>> = {}): FrameFeatures {
  const n = Math.ceil(secs * FPS);
  const col = (v: number) => new Array<number>(n).fill(v);
  return {
    fps: FPS,
    duration: secs,
    rmsDb: col(fill.rmsDb ?? -40),
    onset: col(fill.onset ?? 0),
    centroidHz: col(fill.centroidHz ?? 1000),
    lowDb: col(fill.lowDb ?? -40),
    midDb: col(fill.midDb ?? -40),
    highDb: col(fill.highDb ?? -40),
  };
}

/** Put an onset spike on the frame nearest `t`. */
function hit(f: FrameFeatures, t: number, strength = 100) {
  f.onset[Math.round(t * f.fps)] = strength;
}

/** The step index of beat `b` in a grid. */
function step(grid: { startBeat: number; stepsPerBeat: number }, b: number) {
  return Math.round((b - grid.startBeat) * grid.stepsPerBeat);
}

describe("framesToGrid", () => {
  it("puts a hit at a beat's time on that beat's step, at a steady tempo", () => {
    const curve = Curve.constantBpm(120, { t0: 0.3 }); // beat 0 at 0.3 s
    const f = frames(10);
    hit(f, curve.toTime(8));
    const g = framesToGrid(f, curve);

    expect(g.stepsPerBeat).toBe(4);
    const peak = g.onset.indexOf(Math.max(...g.onset));
    expect(peak).toBe(step(g, 8));
  });

  it("follows a drifting tempo", () => {
    // 120 bpm for 8 beats, then slowing: each beat 10 ms longer than the last.
    const anchors = [{ b: 0, t: 0 }];
    let t = 0;
    for (let b = 1; b <= 30; b++) {
      t += 0.5 + Math.max(0, b - 8) * 0.01;
      anchors.push({ b, t });
    }
    const curve = new Curve(anchors);
    const f = frames(t + 1);
    for (const b of [4, 20.5, 27.25]) hit(f, curve.toTime(b));
    const g = framesToGrid(f, curve);

    for (const b of [4, 20.5, 27.25]) expect(g.onset[step(g, b)], `beat ${b}`).toBe(100);
    const hits = g.onset.filter((v) => v === 100).length;
    expect(hits).toBe(3);
  });

  it("covers the recording from its first frame to its last", () => {
    const curve = Curve.constantBpm(120, { t0: 1 }); // the recording starts 2 beats early
    const g = framesToGrid(frames(5), curve);
    expect(g.startBeat).toBe(-2);
    expect(g.startBeat + g.onset.length / g.stepsPerBeat).toBeCloseTo(curve.toBeat(5), 0);
  });

  it("keeps the strongest onset in a step and averages the rest", () => {
    const curve = Curve.constantBpm(120);
    const f = frames(4);
    // Beat 2 is at 1.0 s; its step at 120 bpm spans 1.0 ± 62.5 ms.
    f.onset[98] = 30;
    f.onset[100] = 80;
    f.onset[103] = 50;
    for (let i = 95; i <= 105; i++) f.rmsDb[i] = i < 100 ? -20 : -10;
    const g = framesToGrid(f, curve);
    const s = step(g, 2);

    expect(g.onset[s]).toBe(80);
    expect(g.rmsDb[s]).toBeGreaterThan(-40);
    expect(g.rmsDb[s]).toBeLessThan(-10);
  });
});

describe("normalizeGrid", () => {
  const curve = Curve.constantBpm(120);

  it("scales each stem against its own loud passages", () => {
    const quiet = frames(10, { rmsDb: -45, onset: 2 });
    const loud = frames(10, { rmsDb: -10, onset: 200 });
    for (let i = 0; i < 1000; i += 50) {
      quiet.onset[i] = 4;
      loud.onset[i] = 400;
    }
    const q = normalizeGrid(framesToGrid(quiet, curve));
    const l = normalizeGrid(framesToGrid(loud, curve));

    // A steady stem reads the same whatever its level.
    expect(q.loud[20]).toBeCloseTo(l.loud[20], 5);
    expect(Math.max(...q.onset)).toBe(1);
    expect(Math.max(...l.onset)).toBe(1);
  });

  it("puts the 95th percentile at 1 and clips one huge hit", () => {
    const f = frames(10, { onset: 10 });
    for (let i = 0; i < 1000; i += 25) f.onset[i] = 50; // the stem's real hits
    f.onset[500] = 5000; // one outlier
    const n = normalizeGrid(framesToGrid(f, curve));

    expect(Math.max(...n.onset)).toBe(1);
    const hits = n.onset.filter((v) => v === 1).length;
    expect(hits).toBeGreaterThan(5); // the real hits reach the top, not just the outlier
    for (const k of ["loud", "onset", "bright", "low", "mid", "high"] as const) {
      for (const v of n[k]) expect(v, k).toBeGreaterThanOrEqual(0);
      for (const v of n[k]) expect(v, k).toBeLessThanOrEqual(1);
    }
  });

  it("reads silence as zero, not as the stem's own loud", () => {
    const f = frames(10, { rmsDb: -120, lowDb: -120, midDb: -120, highDb: -120, centroidHz: 0 });
    const n = normalizeGrid(framesToGrid(f, curve));
    for (const k of ["loud", "onset", "bright", "low", "mid", "high"] as const) {
      expect(Math.max(...n[k]), k).toBe(0);
    }
  });
});
