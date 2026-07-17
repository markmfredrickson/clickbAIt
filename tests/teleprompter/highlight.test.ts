import { describe, it, expect } from "vitest";
import { activeIndex } from "../../src/teleprompter/highlight.js";

// The client feeds arrays of objects (words/lines/sections) with a beat field.
// activeIndex is the single "what's active now" rule shared across all three.
const words = [
  { startBeat: 0, text: "a" },
  { startBeat: 4, text: "b" },
  { startBeat: 8, text: "c" },
  { startBeat: 12, text: "d" },
];
const startBeat = (w: { startBeat: number }) => w.startBeat;

describe("activeIndex", () => {
  it("returns -1 before the first item", () => {
    expect(activeIndex(words, -1, startBeat)).toBe(-1);
  });

  it("is inclusive at an item's own beat", () => {
    expect(activeIndex(words, 0, startBeat)).toBe(0);
    expect(activeIndex(words, 4, startBeat)).toBe(1);
  });

  it("picks the last item at or before the beat (between items)", () => {
    expect(activeIndex(words, 5, startBeat)).toBe(1); // past b(4), before c(8)
    expect(activeIndex(words, 11.9, startBeat)).toBe(2);
  });

  it("stays on the final item once past it", () => {
    expect(activeIndex(words, 100, startBeat)).toBe(3);
  });

  it("works with any beat accessor (legacy line / section shape)", () => {
    const lines = [{ beat: 0 }, { beat: 8 }, { beat: 24 }];
    expect(activeIndex(lines, 10, (l) => l.beat)).toBe(1);
    expect(activeIndex(lines, 24, (l) => l.beat)).toBe(2);
  });

  it("returns -1 on an empty list", () => {
    expect(activeIndex([], 5, startBeat)).toBe(-1);
  });
});
