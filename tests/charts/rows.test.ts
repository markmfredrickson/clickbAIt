import { describe, it, expect } from "vitest";
import { buildRows, rowAt, type RowInput } from "../../src/charts/rows.js";
import { songSections, type MappedBar } from "../../src/charts/bar-map.js";

// A short song: Intro (4 bars, instrumental), Verse (4 bars, two lines, the
// first a pickup sung in the Intro's last bar), Verse (4 bars, one line).
// 4/4, so the sections start at beats 0, 16 and 32.
const SECTIONS = songSections(
  [{ name: "Intro", bars: 4 }, { name: "Verse", bars: 4 }, { name: "Verse", bars: 4 }],
  [4, 4],
);
const words = [
  { startBeat: 14.5, endBeat: 15 }, // pickup into Verse 1
  { startBeat: 16, endBeat: 17 },
  { startBeat: 18, endBeat: 19 },
  { startBeat: 24, endBeat: 25 }, // line 2
  { startBeat: 26, endBeat: 27 },
  { startBeat: 33, endBeat: 34 }, // Verse 2
  { startBeat: 36, endBeat: 38 },
];
const lines = [
  { words: [0, 2] as [number, number], section: "Verse", sectionIndex: 1 },
  { words: [3, 4] as [number, number], section: "Verse", sectionIndex: 1 },
  { words: [5, 6] as [number, number], section: "Verse", sectionIndex: 2 },
];

/** A chart that has score bars for the verses only. */
const verseTab: MappedBar[] = SECTIONS.flatMap((s, si) =>
  Array.from({ length: s.bars }, (_, i) => ({
    songBar: s.firstBar + i,
    section: si,
    startBeat: s.startBeat + i * s.beatsPerBar,
    beats: s.beatsPerBar,
    scoreBar: s.name === "Verse" ? 9 + i : null,
  })),
);

const INPUT: RowInput = { sections: SECTIONS, words, lines, charts: { "rhythm-guitar": verseTab } };

describe("buildRows — text only", () => {
  const rows = buildRows(INPUT, ["sections", "lyrics"], { barsPerRow: 4 });

  it("is one row per lyric line, plus a row for each section without lines", () => {
    expect(rows.map((r) => r.kind)).toEqual(["section", "line", "line", "line"]);
    expect(rows.filter((r) => r.kind === "line").map((r) => r.kind === "line" && r.words)).toEqual([[0, 2], [3, 4], [5, 6]]);
  });

  it("assigns lines to section occurrences in order, even with repeated names", () => {
    expect(rows.map((r) => r.section)).toEqual([0, 1, 1, 2]);
  });

  it("labels the first row of each section", () => {
    expect(rows.map((r) => r.label ?? null)).toEqual(["Intro", "Verse", null, "Verse"]);
  });

  it("starts a line row at its first word, so a pickup row starts before its section", () => {
    expect(rows[1].startBeat).toBe(14.5);
  });

  it("places lines by section name when a display file predates sectionIndex and names are unique", () => {
    const sections = songSections([{ name: "Intro", bars: 4 }, { name: "Verse 1", bars: 4 }, { name: "Verse 2", bars: 4 }], [4, 4]);
    const old = lines.map(({ words }, i) => ({ words, section: i < 2 ? "Verse 1" : "Verse 2" }));
    const r = buildRows({ ...INPUT, sections, lines: old }, ["sections", "lyrics"], { barsPerRow: 4 });
    expect(r.map((row) => row.section)).toEqual([0, 1, 1, 2]);
  });

  it("refuses to guess when an old display file repeats a section name", () => {
    const old = lines.map(({ words, section }) => ({ words, section }));
    expect(() => buildRows({ ...INPUT, lines: old }, ["sections", "lyrics"], { barsPerRow: 4 })).toThrow(/Verse.*rebuild/);
  });
});

describe("buildRows — with notation", () => {
  const rows = buildRows(INPUT, ["sections", "lyrics", "rhythm-guitar"], { barsPerRow: 2 });

  it("groups bars into rows that never cross a section boundary", () => {
    expect(rows.every((r) => r.kind === "bars")).toBe(true);
    expect(rows.map((r) => r.kind === "bars" && r.bars)).toEqual([[1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12]]);
    expect(rows.map((r) => r.section)).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it("gives each row the score bars of each requested chart, null where it has none", () => {
    const n = (i: number) => (rows[i].kind === "bars" ? rows[i].notation["rhythm-guitar"] : undefined);
    expect(n(0)).toEqual([null, null]);
    expect(n(2)).toEqual([9, 10]);
  });

  it("puts each word in the row that contains its beat, so a pickup sits in the previous section", () => {
    const w = rows.map((r) => (r.kind === "bars" ? r.words : undefined));
    expect(w).toEqual([null, [0, 0], [1, 2], [3, 4], [5, 6], null]);
  });

  it("labels the first row of each section", () => {
    expect(rows.map((r) => r.label ?? null)).toEqual(["Intro", null, "Verse", null, "Verse", null]);
  });

  it("leaves words out when lyrics aren't requested", () => {
    const noLyrics = buildRows(INPUT, ["rhythm-guitar"], { barsPerRow: 2 });
    expect(noLyrics.every((r) => r.kind === "bars" && r.words === null)).toBe(true);
  });

  it("uses a short last row when a section doesn't divide evenly", () => {
    const threes = buildRows(INPUT, ["rhythm-guitar"], { barsPerRow: 3 });
    expect(threes.map((r) => r.kind === "bars" && r.bars)).toEqual([[1, 3], [4, 4], [5, 7], [8, 8], [9, 11], [12, 12]]);
  });
});

describe("buildRows — any channel set", () => {
  it("gives the same rows for the same request", () => {
    const a = buildRows(INPUT, ["lyrics", "rhythm-guitar"], { barsPerRow: 2 });
    const b = buildRows(INPUT, ["lyrics", "rhythm-guitar"], { barsPerRow: 2 });
    expect(a).toEqual(b);
  });
});

describe("rowAt", () => {
  const text = buildRows(INPUT, ["sections", "lyrics"], { barsPerRow: 4 });
  const bars = buildRows(INPUT, ["lyrics", "rhythm-guitar"], { barsPerRow: 2 });

  it("finds the row containing a beat, in either layout", () => {
    expect(rowAt(text, 25)).toBe(2); // second Verse 1 line
    expect(bars[rowAt(bars, 25)]).toMatchObject({ section: 1, bars: [7, 8] });
  });

  it("keeps the same place across a channel switch", () => {
    // Beat 33 is in Verse 2 whichever channels are showing.
    expect(text[rowAt(text, 33)].section).toBe(2);
    expect(bars[rowAt(bars, 33)].section).toBe(2);
  });

  it("clamps before the first row and after the last", () => {
    expect(rowAt(bars, -4)).toBe(0);
    expect(rowAt(bars, 999)).toBe(bars.length - 1);
  });
});
