import { describe, it, expect } from "vitest";
import { rephaseBeats } from "../src/authoring/rephase-beats.js";

type B = { time: number; strength: number };
const beats = (times: number[], strength = 0.4): B[] => times.map((time) => ({ time, strength }));

// Detected pins on the OFFBEATS: 1.3, 1.9, 2.5, 3.1 (period 0.6).
// True beats live at the midpoints: 1.0, 1.6, 2.2, 2.8.
const PINS = beats([1.3, 1.9, 2.5, 3.1]);

describe("rephaseBeats", () => {
  it("moves each beat to the midpoint of its neighbors when no onset is near", () => {
    const out = rephaseBeats(PINS, []);
    expect(out.map((b) => Number(b.time.toFixed(3)))).toEqual([1.0, 1.6, 2.2, 2.8]);
  });

  it("snaps a midpoint to the strongest onset within tolerance", () => {
    const onsets = [
      { time: 1.63, strength: 0.9 }, // the real hit, slightly late of the midpoint
      { time: 1.58, strength: 0.1 },
    ];
    const out = rephaseBeats(PINS, onsets);
    expect(out[1].time).toBeCloseTo(1.63, 5);
  });

  it("does not snap to an onset outside the tolerance", () => {
    const onsets = [{ time: 1.85, strength: 0.9 }]; // 0.25 from midpoint 1.6 — an eighth away
    const out = rephaseBeats(PINS, onsets, { tolerance: 0.08 });
    expect(out[1].time).toBeCloseTo(1.6, 5);
  });

  it("extrapolates the leading beat half a period before the first pin", () => {
    const out = rephaseBeats(PINS, []);
    expect(out[0].time).toBeCloseTo(1.0, 5);
  });

  it("snaps the leading beat to a real onset too (the downbeat strum)", () => {
    const onsets = [{ time: 0.97, strength: 0.8 }];
    const out = rephaseBeats(PINS, onsets);
    expect(out[0].time).toBeCloseTo(0.97, 5);
  });

  it("keeps count and stays strictly ascending", () => {
    const out = rephaseBeats(PINS, beats([1.02, 1.61, 2.19, 2.83], 0.7));
    expect(out).toHaveLength(PINS.length);
    for (let i = 1; i < out.length; i++) expect(out[i].time).toBeGreaterThan(out[i - 1].time);
  });

  it("returns [] for fewer than two pins", () => {
    expect(rephaseBeats(beats([1.3]), [])).toEqual([]);
  });
});
