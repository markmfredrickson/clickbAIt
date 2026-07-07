import { describe, it, expect } from "vitest";
import { TimeSignature } from "../src/core/time-signature.js";

describe("TimeSignature", () => {
  it("stores numerator and denominator", () => {
    const ts = new TimeSignature(4, 4);
    expect(ts.numerator).toBe(4);
    expect(ts.denominator).toBe(4);
  });

  it("computes beatsPerBar", () => {
    expect(new TimeSignature(4, 4).beatsPerBar).toBe(4);
    expect(new TimeSignature(7, 4).beatsPerBar).toBe(7);
    expect(new TimeSignature(6, 8).beatsPerBar).toBe(6);
  });

  it("throws on invalid numerator", () => {
    expect(() => new TimeSignature(0, 4)).toThrow(RangeError);
    expect(() => new TimeSignature(-3, 4)).toThrow(RangeError);
    expect(() => new TimeSignature(3.5, 4)).toThrow(RangeError);
  });

  it("throws on invalid denominator", () => {
    expect(() => new TimeSignature(4, 0)).toThrow(RangeError);
    expect(() => new TimeSignature(4, -8)).toThrow(RangeError);
  });

  describe("quantize in 4/4", () => {
    const ts = new TimeSignature(4, 4);

    it("snaps to whole beats by default (grid=1)", () => {
      expect(ts.quantize(3.3)).toBe(3);
      expect(ts.quantize(3.6)).toBe(4);
      expect(ts.quantize(3.5)).toBe(4);
    });

    it("snaps to 8th notes (grid=2)", () => {
      expect(ts.quantize(3.3, 2)).toBe(3.5);
      expect(ts.quantize(3.1, 2)).toBe(3);
      expect(ts.quantize(3.8, 2)).toBe(4);
    });

    it("snaps to 16th notes (grid=4)", () => {
      expect(ts.quantize(3.13, 4)).toBe(3.25);
      expect(ts.quantize(3.1, 4)).toBe(3);
      expect(ts.quantize(3.87, 4)).toBe(3.75);
    });
  });

  describe("quantize in 6/8", () => {
    const ts = new TimeSignature(6, 8);

    it("snaps to whole beats by default", () => {
      expect(ts.quantize(2.3)).toBe(2);
      expect(ts.quantize(2.7)).toBe(3);
    });

    it("snaps to 16th notes (grid=2)", () => {
      // In 6/8 the beat is an 8th, so grid=2 halves it to 16ths
      expect(ts.quantize(2.3, 2)).toBe(2.5);
      expect(ts.quantize(2.1, 2)).toBe(2);
    });
  });

  describe("quantize in 7/4", () => {
    const ts = new TimeSignature(7, 4);

    it("snaps to whole beats by default", () => {
      expect(ts.quantize(5.4)).toBe(5);
      expect(ts.quantize(5.6)).toBe(6);
    });

    it("snaps to 16th notes (grid=4)", () => {
      expect(ts.quantize(5.13, 4)).toBe(5.25);
    });
  });
});
