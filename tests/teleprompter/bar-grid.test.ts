import { describe, it, expect } from "vitest";
import { barGrid } from "../../src/teleprompter/bar-grid.js";

describe("barGrid", () => {
  it("uses a column per beat when every chord falls on a beat", () => {
    expect(barGrid({ beats: 4, chords: [{ at: 0 }, { at: 0.5 }] })).toEqual({ columns: 4, starts: [1, 3] });
  });

  it("splits beats into eighths only when a chord needs it", () => {
    expect(barGrid({ beats: 4, chords: [{ at: 0 }, { at: 0.875 }] })).toEqual({ columns: 8, starts: [1, 8] });
  });

  it("follows the bar's meter", () => {
    expect(barGrid({ beats: 3, chords: [{ at: 0 }] })).toEqual({ columns: 3, starts: [1] });
  });

  it("falls back to sixteenths, rounding, for anything finer", () => {
    expect(barGrid({ beats: 4, chords: [{ at: 0.1 }] })).toEqual({ columns: 16, starts: [3] });
  });
});
