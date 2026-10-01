import { describe, it, expect } from "vitest";
import { drawingKey, notationRanges, scoreSegments } from "../../src/teleprompter/drawings.js";
import type { RowDocument, ScoreBar } from "../../src/teleprompter/rows.js";

const bar = (scoreBar: number | null, i: number): ScoreBar => ({ songBar: i + 1, start: i * 4, end: i * 4 + 4, scoreBar });

describe("scoreSegments", () => {
  it("draws a row's bars in one piece when their score bars run on", () => {
    expect(scoreSegments([9, 10, 11, 12].map(bar))).toEqual([{ first: 0, count: 4, start: 9 }]);
  });

  it("breaks where the score jumps, as when a section repeats a range", () => {
    expect(scoreSegments([9, 10, 9, 10].map(bar))).toEqual([
      { first: 0, count: 2, start: 9 },
      { first: 2, count: 2, start: 9 },
    ]);
  });

  it("gives bars the score has nothing for a piece of their own, with nothing to draw", () => {
    expect(scoreSegments([null, null, 3, 4].map(bar))).toEqual([
      { first: 0, count: 2, start: null },
      { first: 2, count: 2, start: 3 },
    ]);
  });
});

describe("notationRanges", () => {
  const run = (scoreBars: number[], draw: boolean) => ({
    letter: "A", scoreBars, barBeats: scoreBars.map(() => 4), draw, count: 1, phraseBeats: 4 * scoreBars.length, songBar: 1, start: 0, end: 4,
  });
  const doc = {
    channels: [
      { id: "lyrics", kind: "lyrics", rows: [] },
      { id: "kit", kind: "figures", chart: "drums", instrument: "drums", source: "s.gp5", track: 4, rows: [
        { type: "figures", section: 0, start: 0, end: 8, items: [run([3, 7], true)] },
        { type: "figures", section: 1, start: 8, end: 16, items: [run([3], true), run([7], false)] },
        // A section drawn as a score inside a chart-style part.
        { type: "score", section: 2, start: 16, end: 24, items: [20, 21].map(bar) },
      ] },
      { id: "vocals", kind: "score", chart: "staff", instrument: "vocals", source: "s.gp5", track: 0, rows: [
        { type: "score", section: 0, start: 0, end: 16, items: [9, 10, 11, 12].map(bar) },
        { type: "score", section: 1, start: 16, end: 24, items: [null, 13].map(bar) },
      ] },
    ],
  } as unknown as RowDocument;

  it("lists, per chart, the bars to draw: each drawn figure bar once, and each score row's pieces", () => {
    expect(notationRanges(doc)).toEqual([
      { id: "kit", source: "s.gp5", track: 4, chart: "drums", ranges: [{ start: 3, count: 1 }, { start: 7, count: 1 }, { start: 20, count: 2 }] },
      { id: "vocals", source: "s.gp5", track: 0, chart: "staff", ranges: [{ start: 9, count: 4 }, { start: 13, count: 1 }] },
    ]);
  });

  it("draws the card's figures too, though a score section took their first time", () => {
    const withCard = { ...doc, card: { startBeat: 0, notes: [], opening: {}, figures: { kit: [{ letter: "A", scoreBars: [3] }, { letter: "Z", scoreBars: [99, 100] }] } } } as unknown as RowDocument;
    expect(notationRanges(withCard)[0].ranges).toEqual([{ start: 3, count: 1 }, { start: 7, count: 1 }, { start: 20, count: 2 }, { start: 99, count: 2 }]);
  });

  it("names a drawing by where it starts and how many bars", () => {
    expect(drawingKey(9, 4)).toBe("9+4");
  });
});
