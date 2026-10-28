import { describe, it, expect } from "vitest";
import { boxAt, markAt, parseRotation, passOf, screenToPage, type Mark } from "../../src/teleprompter/eink/layout.js";

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
  // A run of 8 times through a one-bar figure of 4 beats, from beat 32.
  const run: Mark = { ...box, start: 32, end: 64, count: 8, passBeats: 4 };

  it("counts which bar of the run is playing", () => {
    expect(passOf(run, 32)).toEqual({ pass: 1, of: 8 });
    expect(passOf(run, 63.5)).toEqual({ pass: 8, of: 8 });
  });

  it("is nothing outside the run, or for a mark that isn't a run", () => {
    expect(passOf(run, 64)).toBeNull();
    expect(passOf(lines[0], 5)).toBeNull();
  });
});

describe("boxAt", () => {
  // A two-bar figure, 4 and 2 beats, three times through from beat 10, each bar boxed.
  const bars = [{ x: 0, y: 0, w: 50, h: 20 }, { x: 50, y: 0, w: 30, h: 20 }];
  const run: Mark = { ...box, start: 10, end: 28, count: 3, passBeats: 6, bars, barBeats: [4, 2] };

  it("boxes the bar playing in a run, on every time through", () => {
    expect(boxAt(run, 10)).toEqual(bars[0]);
    expect(boxAt(run, 14)).toEqual(bars[1]);
    expect(boxAt(run, 16.5)).toEqual(bars[0]);
    expect(boxAt(run, 27.9)).toEqual(bars[1]);
  });

  it("boxes the whole mark when it has no bars", () => {
    expect(boxAt(lines[0], 5)).toEqual(box);
  });
});

describe("screenToPage", () => {
  // A 600 × 800 portrait screen; the page laid out 800 wide, 600 tall.
  it("turned left, the page's top-left is the screen's top-right", () => {
    expect(screenToPage("left", 600, 0, 600, 800)).toEqual({ x: 0, y: 0 });
    expect(screenToPage("left", 0, 800, 600, 800)).toEqual({ x: 800, y: 600 });
  });

  it("turned right, the page's top-left is the screen's bottom-left", () => {
    expect(screenToPage("right", 0, 800, 600, 800)).toEqual({ x: 0, y: 0 });
    expect(screenToPage("right", 600, 0, 600, 800)).toEqual({ x: 800, y: 600 });
  });

  it("leaves an unturned screen alone", () => {
    expect(screenToPage(null, 10, 20, 600, 800)).toEqual({ x: 10, y: 20 });
    expect(parseRotation("sideways")).toBeNull();
  });
});
