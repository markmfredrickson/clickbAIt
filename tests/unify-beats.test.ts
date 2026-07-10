import { describe, it, expect } from "vitest";
import { unifyBeats, type DetectedBeat } from "../src/core/unify-beats.js";

/** Convenience: build a beat list from times, all at the given strength. */
const grid = (times: number[], strength = 0.9): DetectedBeat[] =>
  times.map((time) => ({ time, strength }));

/** Min gap between consecutive beats — a doubled beat shows up as a tiny gap. */
const minGap = (beats: DetectedBeat[]): number =>
  Math.min(...beats.slice(1).map((b, i) => b.time - beats[i].time));

describe("unifyBeats", () => {
  it("follows the drum grid when drums play throughout", () => {
    // Full-mix beats are slightly off the (tighter) drum beats; the drum grid wins.
    const full = grid([0, 0.5, 1.0, 1.5]);
    const drum = grid([0.01, 0.51, 1.01, 1.51]);
    const out = unifyBeats(full, drum);
    expect(out.map((b) => b.time)).toEqual([0.01, 0.51, 1.01, 1.51]);
  });

  it("uses full-mix beats through a drum-silent intro, drum beats after entry", () => {
    // Full mix covers 0..3.5; drums only enter at 2.0.
    const full = grid([0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5]);
    const drum = grid([2.0, 2.5, 3.0, 3.5]);
    const out = unifyBeats(full, drum);
    expect(out.map((b) => b.time)).toEqual([0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5]);
    // No doubled/dropped beat at the seam: spacing stays ~1 IBI (0.5s).
    expect(minGap(out)).toBeGreaterThan(0.3);
  });

  it("uses full-mix beats after the drums stop (drum-silent outro)", () => {
    // Drums play the first four beats, then drop out; the full mix carries the
    // outro. Distinguish source by strength: drum 0.9, full 0.7.
    const full = grid([0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5], 0.7);
    const drum = grid([0, 0.5, 1.0, 1.5], 0.9);
    const out = unifyBeats(full, drum);
    expect(out.map((b) => b.time)).toEqual([0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5]);
    // In-span beats came from the drum stem, the outro from the full mix.
    expect(out.slice(0, 4).every((b) => b.strength === 0.9)).toBe(true);
    expect(out.slice(4).every((b) => b.strength === 0.7)).toBe(true);
  });

  it("reconciles a small phase offset at the seam without doubling", () => {
    const full = grid([0, 0.5, 1.0, 1.5, 2.0]);
    const drum = grid([1.05, 1.55, 2.05]); // ~50ms late relative to the full grid
    const out = unifyBeats(full, drum);
    // The full-mix beat at 1.0 and the drum beat at 1.05 must not both survive.
    expect(minGap(out)).toBeGreaterThan(0.3);
    // The seam takes the drum beat, not the full-mix one.
    expect(out.some((b) => b.time === 1.05)).toBe(true);
    expect(out.some((b) => b.time === 1.0)).toBe(false);
  });

  it("returns the other grid unchanged when one input is empty", () => {
    const full = grid([0, 0.5, 1.0]);
    expect(unifyBeats(full, []).map((b) => b.time)).toEqual([0, 0.5, 1.0]);
    expect(unifyBeats([], full).map((b) => b.time)).toEqual([0, 0.5, 1.0]);
    expect(unifyBeats([], [])).toEqual([]);
  });

  it("falls back to full-mix when no drum beat is confident", () => {
    const full = grid([0, 0.5, 1.0]);
    const drum = grid([0.02, 0.52, 1.02], 0.1); // all weak
    // maxDrum is 0.1, so threshold 0.05 keeps them 'strong' relative to their own
    // max — force the fallback with a threshold above the weak strengths.
    const out = unifyBeats(full, drum, { strongThreshold: 5 });
    expect(out.map((b) => b.time)).toEqual([0, 0.5, 1.0]);
  });
});
