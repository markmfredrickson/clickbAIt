import { describe, it, expect } from "vitest";
import { barFit, joinSectionRows, lineGroup, noteZoom, parseStaffPx, splitRows } from "../../src/teleprompter/flow.js";
import { itemsAt, type FigureItem, type FigureRow, type RowChannel, type RowDocument, type ScoreBar, type ScoreRow } from "../../src/teleprompter/rows.js";

describe("noteZoom", () => {
  it("draws the staff lines the asked distance apart", () => {
    // alphaTab draws them 9 px apart at its own size.
    expect(noteZoom(9)).toBe(1);
    expect(noteZoom(18)).toBe(2);
  });

  it("reads a size from a URL, within reason", () => {
    expect(parseStaffPx("12")).toBe(12);
    expect(parseStaffPx("2")).toBeNull();
    expect(parseStaffPx("huge")).toBeNull();
    expect(parseStaffPx(null)).toBeNull();
  });
});

describe("barFit", () => {
  it("keeps a bar at the note size when it fits a line", () => {
    expect(barFit(300, 1000)).toBe(1);
  });

  it("shrinks only a bar wider than a whole line, to fit it", () => {
    expect(barFit(600, 300)).toBe(0.5);
  });

  it("keeps a run's count on the line with its last bar", () => {
    // The count doesn't shrink with the notation: 300 px of room less 60 px of count.
    expect(barFit(480, 300, 60)).toBe(0.5);
  });

  it("stops at a floor rather than vanish", () => {
    expect(barFit(10000, 300)).toBe(0.3);
  });
});

describe("lineGroup", () => {
  it("breaks a four-bar figure 2 + 2 where three would fit, not 3 + 1", () => {
    expect(lineGroup([300, 300, 300, 300], 1000)).toBe(2);
  });

  it("keeps the figure on one line when it fits", () => {
    expect(lineGroup([200, 200, 200, 200], 1000)).toBe(4);
  });

  it("counts the run's count beside its last bar", () => {
    expect(lineGroup([240, 240, 240, 240], 1000, 60)).toBe(2);
  });

  it("checks every group, not only the first", () => {
    expect(lineGroup([200, 200, 450, 450], 1000)).toBe(2);
    expect(lineGroup([200, 200, 600, 450], 1000)).toBeNull();
    expect(lineGroup([1200], 1000)).toBe(1);
  });

  it("lets bars run on as they fit when only single bars divide evenly", () => {
    // Three bars, two fit: no even split but one a line, so no breaks are forced.
    expect(lineGroup([400, 400, 400], 1000)).toBeNull();
  });
});

const bar = (start: number, songBar: number): ScoreBar => ({ start, end: start + 4, songBar, scoreBar: songBar });
const scoreRow = (bars: ScoreBar[]): ScoreRow => ({ type: "score", section: 0, start: bars[0].start, end: bars[bars.length - 1].end, items: bars });
const run = (start: number, bars: number, count: number): FigureItem => ({
  scoreBars: Array.from({ length: bars }, (_, i) => i + 1),
  barBeats: Array(bars).fill(4),
  count,
  phraseBeats: bars * 4,
  songBar: start / 4 + 1,
  start,
  end: start + bars * 4 * count,
});
const figureRow = (runs: FigureItem[]): FigureRow => ({ type: "figures", section: 0, start: runs[0].start, end: runs[runs.length - 1].end, items: runs });

describe("splitRows", () => {
  it("gives a score row a row per line it wraps onto", () => {
    const row = scoreRow([bar(0, 1), bar(4, 2), bar(8, 3), bar(12, 4)]);
    // Bars 1-2 on the first line, 3-4 on the second.
    const rows = splitRows([row], [[0, 0, 1, 1].map((l) => ({ first: l, last: l }))]);
    expect(rows.map((r) => r.items.map((b) => (b as ScoreBar).songBar))).toEqual([[1, 2], [3, 4]]);
    expect(rows.map((r) => [r.start, r.end])).toEqual([[0, 8], [8, 16]]);
  });

  it("leaves a row that fits on one line alone", () => {
    const row = scoreRow([bar(0, 1), bar(4, 2)]);
    expect(splitRows([row], [[{ first: 0, last: 0 }, { first: 0, last: 0 }]])).toEqual([row]);
  });

  it("splits a figure row only where a run starts a new line, keeping a wrapped run whole", () => {
    // A: one bar ×4 (line 0). B: four bars ×2, wrapping from line 1 to 2. C: one bar ×2, after B on line 2.
    const a = run(0, 1, 4), b = run(16, 4, 2), c = run(48, 1, 2);
    const rows = splitRows([figureRow([a, b, c])], [[{ first: 0, last: 0 }, { first: 1, last: 2 }, { first: 2, last: 2 }]]);
    expect(rows.map((r) => r.items)).toEqual([[a], [b, c]]);
    expect(rows.map((r) => [r.start, r.end])).toEqual([[0, 16], [16, 56]]);
  });

  it("keeps each row's section", () => {
    const row = { ...scoreRow([bar(0, 1), bar(4, 2)]), section: 3 };
    expect(splitRows([row], [[{ first: 0, last: 0 }, { first: 1, last: 1 }]]).map((r) => r.section)).toEqual([3, 3]);
  });

  it("plays the same bar at every beat as the rows it came from", () => {
    const rows = [figureRow([run(0, 1, 4), run(16, 4, 2), run(48, 1, 2)]), scoreRow([bar(56, 15), bar(60, 16), bar(64, 17)])];
    const lines = [
      [{ first: 0, last: 0 }, { first: 1, last: 2 }, { first: 2, last: 2 }],
      [{ first: 0, last: 0 }, { first: 1, last: 1 }, { first: 1, last: 1 }],
    ];
    const channel = (r: (FigureRow | ScoreRow)[]): RowChannel => ({ id: "drums", kind: "figures", instrument: "drums", chart: "drums", source: "s.gp", track: 0, rows: r });
    const doc = (c: RowChannel) => ({ channels: [c] }) as RowDocument;
    const before = channel(rows), after = channel(splitRows(rows, lines));
    const playing = (c: RowChannel, beat: number) => {
      const at = itemsAt(doc(c), beat).drums;
      const item = at.row >= 0 && at.item >= 0 ? c.rows[at.row].items[at.item] : null;
      return { item, pass: at.pass, bar: at.bar };
    };
    for (let beat = 0; beat < 68; beat += 0.5) expect(playing(after, beat)).toEqual(playing(before, beat));
  });
});

describe("joinSectionRows", () => {
  it("makes a section's score rows one row, to flow by width rather than the build's four bars a row", () => {
    const a = scoreRow([bar(0, 1), bar(4, 2), bar(8, 3), bar(12, 4)]);
    const b = scoreRow([bar(16, 5), bar(20, 6)]);
    const [joined] = joinSectionRows([a, b]);
    expect(joined.items.map((x) => (x as ScoreBar).songBar)).toEqual([1, 2, 3, 4, 5, 6]);
    expect([joined.start, joined.end]).toEqual([0, 24]);
  });

  it("keeps sections apart, and figure rows as they are", () => {
    const a = scoreRow([bar(0, 1)]);
    const b = { ...scoreRow([bar(4, 2)]), section: 1 };
    const f = figureRow([run(8, 1, 2)]);
    expect(joinSectionRows([a, b, f])).toEqual([a, b, f]);
  });
});
