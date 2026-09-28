import { describe, it, expect } from "vitest";
import { dbToFader, faderToDb } from "../../src/mixer/x32-taper.js";

// The X32 fader is a 0..1 float on a four-segment piecewise-linear dB scale.
// These are the segment boundaries; every other value is a straight line
// between two of them.
const BREAKPOINTS: [fader: number, db: number][] = [
  [0, -90],
  [0.0625, -60],
  [0.25, -30],
  [0.5, -10],
  [0.75, 0],
  [1, 10],
];

describe("X32 fader taper", () => {
  it("maps each breakpoint fader value to its dB", () => {
    for (const [f, db] of BREAKPOINTS) expect(faderToDb(f)).toBeCloseTo(db, 9);
  });

  it("maps each breakpoint dB to its fader value", () => {
    for (const [f, db] of BREAKPOINTS) expect(dbToFader(db)).toBeCloseTo(f, 9);
  });

  it("is linear inside a segment", () => {
    // Halfway between 0.5 (-10 dB) and 0.75 (0 dB).
    expect(dbToFader(-5)).toBeCloseTo(0.625, 9);
    expect(faderToDb(0.625)).toBeCloseTo(-5, 9);
  });

  it("round-trips dB → fader → dB across the whole range", () => {
    for (let db = -90; db <= 10; db += 0.5) {
      expect(faderToDb(dbToFader(db))).toBeCloseTo(db, 9);
    }
  });

  it("clamps below -90 dB (and -Infinity) to the bottom of the fader", () => {
    expect(dbToFader(-120)).toBe(0);
    expect(dbToFader(-Infinity)).toBe(0);
  });

  it("clamps above +10 dB to the top of the fader", () => {
    expect(dbToFader(14)).toBe(1);
  });

  it("clamps fader values outside 0..1 before converting", () => {
    expect(faderToDb(-0.2)).toBe(-90);
    expect(faderToDb(1.3)).toBe(10);
  });
});
