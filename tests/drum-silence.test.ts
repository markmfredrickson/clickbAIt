import { describe, it, expect } from "vitest";
import { silentSpans } from "../src/core/drum-silence.js";

const RATE = 8000;

/**
 * A synthetic drum stem: a short decaying hit every `every` seconds, except in
 * the `gaps` (seconds, [start, end)), over `seconds` in total. `level` scales
 * the hits (1 = full scale).
 */
function stem(seconds: number, gaps: Array<[number, number]>, every = 0.5, level = 1): Float32Array {
  const x = new Float32Array(Math.round(seconds * RATE));
  for (let t = 0; t < seconds; t += every) {
    if (gaps.some(([a, b]) => t >= a && t < b)) continue;
    const start = Math.round(t * RATE);
    for (let i = 0; i < 0.12 * RATE && start + i < x.length; i++) {
      x[start + i] = level * Math.sin(i * 0.9) * Math.exp(-i / (0.03 * RATE));
    }
  }
  return x;
}

describe("silentSpans", () => {
  it("finds no silence when the drums play throughout", () => {
    expect(silentSpans(stem(10, []), RATE)).toEqual([]);
  });

  it("finds a one-bar drop-out mid-song", () => {
    // Hits stop for 2 s (a bar at 120 BPM) starting at 4 s.
    const spans = silentSpans(stem(10, [[4, 6]]), RATE);
    expect(spans).toHaveLength(1);
    // Starts once the last hit (at 3.5 s) has decayed, ends at the next hit (6 s).
    expect(spans[0][0]).toBeGreaterThan(3.5);
    expect(spans[0][0]).toBeLessThan(4.0);
    expect(spans[0][1]).toBeCloseTo(6, 1);
  });

  it("ignores a gap shorter than the minimum (a one-beat rest)", () => {
    // Hits every 0.25 s; one 0.6 s rest is shorter than the 1 s minimum.
    expect(silentSpans(stem(10, [[4, 4.6]], 0.25), RATE)).toEqual([]);
  });

  it("finds a silent intro and a silent outro", () => {
    const spans = silentSpans(stem(12, [[0, 3], [9, 12]]), RATE);
    expect(spans).toHaveLength(2);
    expect(spans[0][0]).toBe(0);
    expect(spans[0][1]).toBeCloseTo(3, 1);
    expect(spans[1][1]).toBeCloseTo(12, 1);
  });

  it("does not call a quiet passage silent", () => {
    // Full-level hits, then 3 s of hits 20 dB quieter (a hi-hat-only bar).
    const loud = stem(10, [[4, 7]]);
    const quiet = stem(10, [[0, 4], [7, 10]], 0.5, 0.1);
    const mixed = loud.map((v, i) => v + quiet[i]);
    expect(silentSpans(mixed, RATE)).toEqual([]);
  });
});
