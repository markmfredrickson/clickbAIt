import { describe, it, expect } from "vitest";
import { expandBeatMap, beatMapCurve } from "../src/core/beat-map.js";
import type { BeatMap } from "../src/manifest.js";

describe("expandBeatMap", () => {
  it("expands a stride-1 run to consecutive beats", () => {
    const map: BeatMap = [{ startBeat: 0, times: [0, 0.5, 1.0] }];
    expect(expandBeatMap(map)).toEqual([
      { b: 0, t: 0 },
      { b: 1, t: 0.5 },
      { b: 2, t: 1.0 },
    ]);
  });

  it("honors stride > 1 (every Nth beat pinned)", () => {
    const map: BeatMap = [{ startBeat: 4, stride: 4, times: [2, 4, 6] }];
    expect(expandBeatMap(map)).toEqual([
      { b: 4, t: 2 },
      { b: 8, t: 4 },
      { b: 12, t: 6 },
    ]);
  });

  it("merges pins and runs, sorted by beat", () => {
    const map: BeatMap = [
      { startBeat: 12, times: [11.0, 11.7] },
      { beat: 0, t: 1.07 },
    ];
    expect(expandBeatMap(map)).toEqual([
      { b: 0, t: 1.07 },
      { b: 12, t: 11.0 },
      { b: 13, t: 11.7 },
    ]);
  });
});

describe("beatMapCurve", () => {
  it("interpolates linearly across a gap (the rubato-intro compression)", () => {
    // Pin beat 0 @ 1.07 and beat 12 @ 11.0; beats between fall on the straight
    // line. Beat 6 is the midpoint in both axes.
    const map: BeatMap = [{ beat: 0, t: 1.07 }, { beat: 12, t: 11.0 }];
    const curve = beatMapCurve(map, 83.9);
    expect(curve.toTime(6)).toBeCloseTo((1.07 + 11.0) / 2, 6);
    expect(curve.toBeat(11.0)).toBeCloseTo(12, 6);
  });

  it("extrapolates at the song BPM past the outermost pins, not the edge slope", () => {
    // A slow segment (2 beats over 2s = 1 beat/s) then a lone pin. Before the
    // first pin the curve must run at 120 bpm (2 beats/s), NOT the 1 beat/s
    // interior slope.
    const map: BeatMap = [{ startBeat: 0, times: [0, 2] }]; // beats 0,1 at t 0,2 → 30 bpm interior
    const curve = beatMapCurve(map, 120); // 2 beats/sec
    // One beat before beat 0 at 120 bpm is 0.5s earlier.
    expect(curve.toTime(-1)).toBeCloseTo(-0.5, 6);
    // One beat after the last pin (beat 1 @ t=2) at 120 bpm is 0.5s later.
    expect(curve.toTime(2)).toBeCloseTo(2.5, 6);
  });

  it("accepts a single pin (constant-BPM curve anchored at that point)", () => {
    const map: BeatMap = [{ beat: 0, t: 5 }];
    const curve = beatMapCurve(map, 60); // 1 beat/sec
    expect(curve.toTime(0)).toBeCloseTo(5, 6);
    expect(curve.toTime(10)).toBeCloseTo(15, 6);
    expect(curve.toTime(-10)).toBeCloseTo(-5, 6);
  });

  it("rejects a non-monotonic map (backtracking control points)", () => {
    const map: BeatMap = [{ beat: 0, t: 5 }, { beat: 4, t: 3 }];
    expect(() => beatMapCurve(map, 120)).toThrow(/increase/i);
  });
});
