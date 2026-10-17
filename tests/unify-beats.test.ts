import { describe, it, expect } from "vitest";
import { unifyBeats, type DetectedBeat } from "../src/core/unify-beats.js";

/** Convenience: build a beat list from times, all at the given strength. */
const grid = (times: number[], strength = 0.9): DetectedBeat[] =>
  times.map((time) => ({ time, strength }));

/** Every 0.5 s from `from` to `to` inclusive. */
const every = (from: number, to: number) => Array.from({ length: Math.round((to - from) / 0.5) + 1 }, (_, i) => from + i * 0.5);

const times = (beats: DetectedBeat[]) => beats.map((b) => +b.time.toFixed(3));

describe("unifyBeats", () => {
  it("follows the drum grid when the drums never go silent", () => {
    const full = grid([0, 0.5, 1.0, 1.5], 0.7);
    const drum = grid([0.01, 0.51, 1.01, 1.51]);
    expect(times(unifyBeats(full, drum, []))).toEqual([0.01, 0.51, 1.01, 1.51]);
  });

  it("uses the full mix inside a drum silence and drops the drum tracker's beats there", () => {
    // Drums drop out from 3.2 to 6.0 s. The drum tracker invents a faster pulse
    // through the silence; the full mix keeps the real one.
    const full = grid(every(0, 10), 0.7);
    const drum = grid([...every(0, 3), 3.4, 3.8, 4.2, 4.6, 5.0, 5.4, 5.8, ...every(6, 10)]);
    const out = unifyBeats(full, drum, [[3.2, 6.0]]);
    expect(times(out)).toEqual(every(0, 10));
    expect(out.filter((b) => b.time > 3.2 && b.time < 6).every((b) => b.strength === 0.7)).toBe(true);
    expect(out.filter((b) => b.time <= 3 || b.time >= 6).every((b) => b.strength === 0.9)).toBe(true);
  });

  it("uses the full mix through a silent intro and a silent outro", () => {
    const full = grid(every(0, 8), 0.7);
    const drum = grid(every(2, 6));
    const out = unifyBeats(full, drum, [[0, 1.9], [6.2, 8.5]]);
    expect(times(out)).toEqual(every(0, 8));
    expect(out.filter((b) => b.time >= 2 && b.time <= 6).every((b) => b.strength === 0.9)).toBe(true);
  });

  it("shifts the full-mix beats by their median offset from the drums so the seams line up", () => {
    // The full-mix pass runs 20 ms early everywhere.
    const full = grid(every(0, 10).map((t) => t - 0.02), 0.7);
    const drum = grid([...every(0, 3), ...every(6, 10)]);
    const out = unifyBeats(full, drum, [[3.2, 6.0]]);
    expect(times(out)).toEqual(every(0, 10));
  });

  it("spaces the beats in a silence evenly between the drum beats on either side", () => {
    // The full mix gives the count (5 beats in the gap) but jitters by 30 ms.
    const full = grid([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.53, 3.97, 4.52, 5.03, 5.47, 6, 6.5, 7], 0.7);
    const drum = grid([...every(0, 3), ...every(6, 7)]);
    const out = unifyBeats(full, drum, [[3.2, 5.9]]);
    expect(times(out)).toEqual(every(0, 7));
  });

  it("loses no beat when the drum beat at a silence edge falls inside the silence", () => {
    // The silence starts at 2.95: the drum beat at 3.0 is dropped, and the
    // full-mix beat for that slot sits just before the edge (2.94 after its
    // offset). The slot must still be filled.
    const full = grid(every(0, 8).map((t) => (t === 3 ? 2.94 : t)), 0.7);
    const drum = grid(every(0, 8));
    const out = unifyBeats(full, drum, [[2.95, 5.9]]);
    expect(times(out)).toEqual(every(0, 8));
  });

  it("puts a silent intro on the constant tempo that best fits the full mix, ending at the first drum beat", () => {
    const full = grid([0.02, 0.48, 1.03, 1.49, 2.0, 2.5, 3.0], 0.7);
    const drum = grid(every(2, 3));
    const out = unifyBeats(full, drum, [[0, 1.9]]);
    expect(out).toHaveLength(7);
    out.forEach((b, i) => expect(Math.abs(b.time - i * 0.5)).toBeLessThan(0.015));
  });

  it("reports a silence whose full-mix count disagrees with the drum tempo", () => {
    // The full mix misses a beat in the gap: 4 beats where the drum tempo says 5.
    const full = grid([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 5.5, 6, 6.5], 0.7);
    const drum = grid([...every(0, 3), ...every(6, 6.5)]);
    const notes: string[] = [];
    unifyBeats(full, drum, [[3.2, 5.9]], { onNote: (n) => notes.push(n) });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/3\.0.*6\.0/);
  });

  it("keeps the drum beat when the two passes collide at a seam", () => {
    const full = grid([3.0, 3.5, 4.0, 4.5], 0.7);
    const drum = grid([0, 0.5, 1, 1.5, 2, 2.5, 3.05]);
    const out = unifyBeats(full, drum, [[3.2, 5]]);
    const gaps = out.slice(1).map((b, i) => b.time - out[i].time);
    expect(Math.min(...gaps)).toBeGreaterThan(0.3); // no doubled beat
    expect(out.some((b) => b.time === 3.05 && b.strength === 0.9)).toBe(true);
  });

  it("returns the other grid when one pass is empty", () => {
    const full = grid([0, 0.5, 1.0]);
    expect(times(unifyBeats(full, [], []))).toEqual([0, 0.5, 1.0]);
    expect(times(unifyBeats([], full, []))).toEqual([0, 0.5, 1.0]);
    expect(unifyBeats([], [], [])).toEqual([]);
  });
});
