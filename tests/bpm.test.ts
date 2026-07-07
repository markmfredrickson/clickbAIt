import { describe, it, expect } from "vitest";
import { BPM } from "../src/core/bpm.js";

describe("BPM", () => {
  it("stores the value", () => {
    expect(new BPM(120).value).toBe(120);
  });

  it("computes msPerBeat", () => {
    expect(new BPM(120).msPerBeat).toBe(500);
    expect(new BPM(60).msPerBeat).toBe(1000);
  });

  it("computes secondsPerBeat", () => {
    expect(new BPM(120).secondsPerBeat).toBe(0.5);
    expect(new BPM(60).secondsPerBeat).toBe(1);
  });

  it("converts seconds to beats", () => {
    const bpm = new BPM(120);
    expect(bpm.secondsToBeats(1)).toBe(2);
    expect(bpm.secondsToBeats(0.5)).toBe(1);
    expect(bpm.secondsToBeats(0)).toBe(0);
  });

  it("converts beats to seconds", () => {
    const bpm = new BPM(120);
    expect(bpm.beatsToSeconds(2)).toBe(1);
    expect(bpm.beatsToSeconds(4)).toBe(2);
  });

  it("converts ms to beats", () => {
    const bpm = new BPM(120);
    expect(bpm.msToBeats(500)).toBe(1);
    expect(bpm.msToBeats(1000)).toBe(2);
  });

  it("converts beats to ms", () => {
    const bpm = new BPM(120);
    expect(bpm.beatsToMs(1)).toBe(500);
    expect(bpm.beatsToMs(3)).toBe(1500);
  });

  it("round-trips seconds through beats", () => {
    const bpm = new BPM(97);
    const seconds = 3.7;
    expect(bpm.beatsToSeconds(bpm.secondsToBeats(seconds))).toBeCloseTo(seconds);
  });

  it("round-trips ms through beats", () => {
    const bpm = new BPM(97);
    const ms = 2500;
    expect(bpm.beatsToMs(bpm.msToBeats(ms))).toBeCloseTo(ms);
  });

  it("throws on negative BPM", () => {
    expect(() => new BPM(-120)).toThrow(RangeError);
  });

  it("throws on zero BPM", () => {
    expect(() => new BPM(0)).toThrow(RangeError);
  });

  describe("scale", () => {
    it("doubles tempo", () => {
      const bpm = new BPM(97);
      expect(bpm.scale(2).value).toBe(194);
    });

    it("halves tempo", () => {
      const bpm = new BPM(194);
      expect(bpm.scale(0.5).value).toBe(97);
    });

    it("throws on negative scale", () => {
      expect(() => new BPM(120).scale(-1)).toThrow(RangeError);
    });

    it("throws on zero scale", () => {
      expect(() => new BPM(120).scale(0)).toThrow(RangeError);
    });

    it("returns a new BPM instance", () => {
      const bpm = new BPM(120);
      const scaled = bpm.scale(2);
      expect(scaled).not.toBe(bpm);
      expect(bpm.value).toBe(120); // original unchanged
    });
  });
});
