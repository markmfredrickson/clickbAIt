import { describe, it, expect } from "vitest";
import { chainIntroPins } from "../src/authoring/intro-pins.js";

type B = { time: number; strength: number };
const beats = (times: number[], strength = 0.4): B[] => times.map((time) => ({ time, strength }));

// A detected grid starting at 8.0 with a steady 0.6s period.
const DETECTED = beats([8.0, 8.6, 9.2, 9.8, 10.4, 11.0, 11.6, 12.2]);

describe("chainIntroPins", () => {
  it("chains back from the first detected beat, snapping to onsets", () => {
    // Onsets slightly late of the rigid chain (a human guitarist drifting).
    const onsets = beats([3.85, 4.43, 5.01, 5.62, 6.21, 6.81, 7.42]);
    const pins = chainIntroPins(DETECTED, onsets);
    expect(pins.map((p) => p.time)).toEqual([3.85, 4.43, 5.01, 5.62, 6.21, 6.81, 7.42]);
  });

  it("stops at leading silence instead of extrapolating unevidenced pins", () => {
    // Music starts at ~5.0; nothing before it.
    const onsets = beats([5.01, 5.62, 6.21, 6.81, 7.42]);
    const pins = chainIntroPins(DETECTED, onsets);
    expect(pins[0].time).toBeCloseTo(5.01, 5);
    expect(pins).toHaveLength(5);
  });

  it("ignores onsets below the strength floor", () => {
    const onsets = [
      ...beats([6.21, 6.81, 7.42]),
      { time: 5.62, strength: 0.01 }, // noise — must not become a pin
    ];
    const pins = chainIntroPins(DETECTED, onsets);
    expect(pins.map((p) => p.time)).toEqual([6.21, 6.81, 7.42]);
  });

  it("returns no pins when there are no onsets", () => {
    expect(chainIntroPins(DETECTED, [])).toEqual([]);
  });

  it("prefers the stronger onset when several are within tolerance", () => {
    // A weak flam/ghost 0.09s after the real hit, marginally nearer the rigid
    // expectation — the strong onset must still win (last-nite bar-2 case).
    const onsets = [
      { time: 7.42, strength: 0.3 },
      { time: 7.51, strength: 0.07 },
    ];
    const pins = chainIntroPins(DETECTED, onsets);
    expect(pins.map((p) => p.time)).toEqual([7.42]);
  });

  it("does not snap to an onset far outside the tolerance", () => {
    // One onset near the expected step, then a far-away one — chain stops.
    const onsets = beats([7.42, 5.9]); // 5.9 is ~0.9s from the next expected 6.82
    const pins = chainIntroPins(DETECTED, onsets, { tolerance: 0.15 });
    expect(pins.map((p) => p.time)).toEqual([7.42]);
  });

  it("output is ascending and strictly before the detected grid", () => {
    const onsets = beats([3.85, 4.43, 5.01, 5.62, 6.21, 6.81, 7.42]);
    const pins = chainIntroPins(DETECTED, onsets);
    const sorted = [...pins].sort((a, b) => a.time - b.time);
    expect(pins).toEqual(sorted);
    expect(pins.at(-1)!.time).toBeLessThan(DETECTED[0].time);
  });
});
