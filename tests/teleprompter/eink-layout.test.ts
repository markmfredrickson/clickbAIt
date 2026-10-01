import { describe, it, expect } from "vitest";
import { markAt, passOf, type Mark } from "../../src/teleprompter/eink/layout.js";

const box = { x: 0, y: 0, w: 100, h: 20 };
// Two lyric lines with a gap between them, as marks on a page.
const lines: Mark[] = [
  { ...box, start: 4, end: 10 },
  { ...box, y: 30, start: 16, end: 22 },
];

describe("markAt", () => {
  it("lights the mark playing at the beat", () => {
    expect(markAt(lines, 5)).toBe(0);
    expect(markAt(lines, 16)).toBe(1);
  });

  it("lights nothing between marks, so a line doesn't stay lit through a solo", () => {
    expect(markAt(lines, 12)).toBe(-1);
    expect(markAt(lines, 1)).toBe(-1);
  });

  it("hands straight to the next mark when it starts before the last one ends", () => {
    expect(markAt([{ ...box, start: 0, end: 8 }, { ...box, start: 6, end: 12 }], 7)).toBe(1);
  });
});

describe("passOf", () => {
  // A drum run of 8 bars of 4 beats from beat 32.
  const run: Mark = { ...box, start: 32, end: 64, count: 8, barBeats: 4 };

  it("counts which bar of the run is playing", () => {
    expect(passOf(run, 32)).toEqual({ pass: 1, of: 8 });
    expect(passOf(run, 63.5)).toEqual({ pass: 8, of: 8 });
  });

  it("is nothing outside the run, or for a mark that isn't a run", () => {
    expect(passOf(run, 64)).toBeNull();
    expect(passOf(lines[0], 5)).toBeNull();
  });
});
