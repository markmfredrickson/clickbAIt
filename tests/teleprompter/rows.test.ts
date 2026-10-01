import { describe, it, expect } from "vitest";
import { buildRows, rowsFromDisplay, type RowInput } from "../../src/teleprompter/build-rows.js";
import { channelName, channelTitle, itemsAt, selectChannels } from "../../src/teleprompter/rows.js";
import { figureChart } from "../../src/charts/figures.js";
import { songSections, type MappedBar } from "../../src/charts/bar-map.js";

// Beats: Verse 0–24, Break 24–28 (2 bars of 2/4), Chorus 28–60 (8 bars of 4/4).
const SONG: RowInput["song"] = {
  timeSignature: [4, 4],
  sections: [
    { name: "Verse", bars: 6 },
    { name: "Break", bars: 2, timeSignature: [2, 4] },
    { name: "Chorus", bars: 8, barsPerRow: 3 },
  ],
};

const base = (extra: Partial<RowInput> = {}): RowInput => ({ slug: "song", title: "Song", song: SONG, ...extra });
const channel = (doc: ReturnType<typeof buildRows>, id: string) => doc.channels.find((c) => c.id === id)!;

describe("buildRows: sections", () => {
  it("lists the sections with where they start and end", () => {
    const doc = buildRows(base());
    expect(doc.sections.map((s) => [s.name, s.start, s.end, s.beatsPerBar])).toEqual([
      ["Verse", 0, 24, 4],
      ["Break", 24, 28, 2],
      ["Chorus", 28, 60, 4],
    ]);
  });

  it("has only the channels the song has", () => {
    expect(buildRows(base()).channels).toEqual([]);
  });
});

describe("buildRows: chords", () => {
  const doc = buildRows(
    base({
      chords: [
        { chord: "A", beat: -1 }, // a pickup chord, before bar 1
        { chord: "D", beat: 6 },
        { chord: "E", beat: 18 },
        { chord: "B", beat: 25 },
        { chord: "A", beat: 28 },
      ],
    }),
  );
  const rows = (channel(doc, "chords") as { rows: any[] }).rows;

  it("makes rows of barsPerRow bars (4 by default) that never run past a section", () => {
    // Verse: 4 + 2. Break: 2. Chorus, barsPerRow 3: 3 + 3 + 2.
    expect(rows.map((r) => r.bars.length)).toEqual([4, 2, 2, 3, 3, 2]);
    expect(rows.map((r) => [r.section, r.start, r.end])).toEqual([
      [0, 0, 16],
      [0, 16, 24],
      [1, 24, 28],
      [2, 28, 40],
      [2, 40, 52],
      [2, 52, 60],
    ]);
  });

  it("gives each bar its start and end in its section's meter", () => {
    expect(rows[2].bars).toEqual([
      { start: 24, end: 26 },
      { start: 26, end: 28 },
    ]);
  });

  it("puts each chord in the row it starts in, ending where the next chord starts", () => {
    expect(rows.map((r) => r.items.map((c: any) => [c.chord, c.start, c.end]))).toEqual([
      [
        ["A", -1, 6],
        ["D", 6, 18],
      ],
      [["E", 18, 25]],
      [["B", 25, 28]],
      [["A", 28, 60]], // the last chord lasts to the song's end
      [],
      [],
    ]);
  });
});

describe("buildRows: chord rows with bars in their own meter", () => {
  const doc = buildRows({
    slug: "s",
    title: "S",
    song: { timeSignature: [4, 4], sections: [{ name: "Verse", bars: 6, meters: [{ bar: 2, timeSignature: [2, 4] }] }] },
    chords: [{ chord: "A", beat: 0 }],
  });
  const rows = (doc.channels[0] as { rows: any[] }).rows;

  it("follows the real bar lengths", () => {
    expect(doc.sections[0].end).toBe(22);
    expect(rows.map((r) => [r.start, r.end])).toEqual([
      [0, 14],
      [14, 22],
    ]);
    expect(rows[0].bars.map((b: any) => b.end - b.start)).toEqual([4, 2, 4, 4]);
  });
});

describe("buildRows: lyrics", () => {
  // Two lines; words are placeholders. The second line's last word is
  // followed by nothing, so its hold is clamped.
  const words = [
    { text: "one", startBeat: 3, endBeat: 3.5 }, // short: held at least a beat, but the next word cuts it
    { text: "two", startBeat: 4, endBeat: 9 }, // long before a gap: held at most 3 beats + a half
    { text: "three", startBeat: 12, endBeat: 12.2 },
    { text: "four", startBeat: 13, endBeat: 14 },
  ];
  const doc = buildRows(
    base({
      lyrics: {
        words,
        lines: [
          { words: [0, 1], section: "Verse" },
          { words: [2, 3], tag: "Backing Vocal", section: "Verse" },
        ],
      },
    }),
  );
  const rows = (channel(doc, "lyrics") as { rows: any[] }).rows;

  it("makes a row per line, in order, with its tag", () => {
    expect(rows.map((r) => r.items.map((w: any) => w.text))).toEqual([
      ["one", "two"],
      ["three", "four"],
    ]);
    expect(rows.map((r) => r.tag)).toEqual([undefined, "Backing Vocal"]);
  });

  it("ends each word where its highlight lets go: held 1–3 beats plus a half, cut by the next word", () => {
    expect(rows.flatMap((r) => r.items.map((w: any) => [w.start, w.end]))).toEqual([
      [3, 4],
      [4, 7.5],
      [12, 13],
      [13, 14.5],
    ]);
  });

  it("gives each line the start of its first word and the end of its last", () => {
    expect(rows.map((r) => [r.start, r.end])).toEqual([
      [3, 7.5],
      [12, 14.5],
    ]);
  });
});

describe("buildRows: chart-style parts (figures)", () => {
  // Verse: A ×6. Break: B ×2 (2/4 bars). Chorus: A ×7, then a bar with no score.
  const sections = songSections(SONG.sections, SONG.timeSignature);
  const bars: MappedBar[] = [];
  let beat = 0;
  const add = (section: number, beats: number, scoreBar: number | null) => {
    bars.push({ songBar: bars.length + 1, section, startBeat: beat, beats, scoreBar });
    beat += beats;
  };
  for (let i = 0; i < 6; i++) add(0, 4, 1);
  add(1, 2, 2);
  add(1, 2, 2);
  for (let i = 0; i < 7; i++) add(2, 4, 1);
  add(2, 4, null);
  const figures = figureChart(bars, ["groove", "fill"], sections);
  const doc = buildRows(
    base({ charts: [{ id: "kit", kind: "drums", instrument: "drums", source: "song.gp5", track: 4, style: "chart", bars, figures }] }),
  );
  const kit = channel(doc, "kit") as any;

  it("carries what a display needs to draw the notation", () => {
    expect([kit.kind, kit.chart, kit.instrument, kit.source, kit.track]).toEqual(["figures", "drums", "drums", "song.gp5", 4]);
  });

  it("makes a row per section", () => {
    expect(kit.rows.map((r: any) => [r.section, r.start, r.end])).toEqual([
      [0, 0, 24],
      [1, 24, 28],
      [2, 28, 60],
    ]);
  });

  it("keeps each run whole, with its start, end, phrase length and the score bars to draw", () => {
    expect(kit.rows[2].items.map((r: any) => [r.letters, r.count, r.start, r.end, r.phraseBeats, r.scoreBars, r.draw])).toEqual([
      [["A"], 7, 28, 56, 4, [1], [true]],
      [[null], 1, 56, 60, 4, [null], [false]],
    ]);
  });
});

describe("buildRows: a chart-style part with a section drawn as a score", () => {
  const sections = songSections(SONG.sections, SONG.timeSignature);
  const bars: MappedBar[] = [];
  let beat = 0;
  SONG.sections.forEach((sec, section) => {
    for (let i = 0; i < sec.bars; i++) {
      const beats = sec.timeSignature?.[0] ?? 4;
      bars.push({ songBar: bars.length + 1, section, startBeat: beat, beats, scoreBar: section === 2 ? 10 + i : 1 });
      beat += beats;
    }
  });
  const figures = figureChart(bars, Array.from({ length: 20 }, (_, i) => (i === 0 ? "riff" : `solo ${i}`)), sections);
  const doc = buildRows(
    base({ charts: [{ id: "lead", kind: "tab", instrument: "guitar", source: "s.gp5", track: 1, style: "chart", bars, figures, sectionsAsScore: [2] }] }),
  );
  const lead = channel(doc, "lead") as any;

  it("gives the other sections a figure row each, and that section score rows of barsPerRow bars", () => {
    expect(lead.rows.map((r: any) => [r.type, r.section, r.items.length])).toEqual([
      ["figures", 0, 1],
      ["figures", 1, 1],
      ["score", 2, 3],
      ["score", 2, 3],
      ["score", 2, 2],
    ]);
  });

  it("counts no passes in a score row", () => {
    expect(itemsAt(doc, 30).lead).toEqual({ row: 2, item: 0 });
  });
});

describe("buildRows: score-style parts", () => {
  // The Verse plays score bars 1–6; the Break has none; the Chorus plays 9–16.
  const bars: MappedBar[] = [];
  let beat = 0;
  SONG.sections.forEach((sec, section) => {
    for (let i = 0; i < sec.bars; i++) {
      const beats = sec.timeSignature?.[0] ?? 4;
      bars.push({ songBar: bars.length + 1, section, startBeat: beat, beats, scoreBar: section === 1 ? null : section === 0 ? i + 1 : i + 9 });
      beat += beats;
    }
  });
  const doc = buildRows(base({ charts: [{ id: "vocals", kind: "staff", instrument: "vocals", source: "song.gp5", track: 0, style: "score", bars }] }));
  const vocals = channel(doc, "vocals") as any;

  it("makes rows of barsPerRow bars that never run past a section, like chord rows", () => {
    expect(vocals.kind).toBe("score");
    expect(vocals.rows.map((r: any) => r.items.length)).toEqual([4, 2, 2, 3, 3, 2]);
  });

  it("makes each bar an item, with the score bar that plays there", () => {
    expect(vocals.rows[0].items.map((b: any) => [b.songBar, b.start, b.end, b.scoreBar])).toEqual([
      [1, 0, 4, 1],
      [2, 4, 8, 2],
      [3, 8, 12, 3],
      [4, 12, 16, 4],
    ]);
  });

  it("keeps a bar the score has nothing for, so the bars still follow the song", () => {
    expect(vocals.rows[2].items.map((b: any) => [b.start, b.end, b.scoreBar])).toEqual([
      [24, 26, null],
      [26, 28, null],
    ]);
  });
});

describe("selectChannels", () => {
  const doc = buildRows(
    base({
      chords: [{ chord: "A", beat: 0 }],
      lyrics: { words: [{ text: "one", startBeat: 0, endBeat: 1 }], lines: [{ words: [0, 0] }] },
    }),
  );

  it("keeps the channels asked for, in the order asked", () => {
    expect(selectChannels(doc, ["chords", "lyrics"]).channels.map((c) => c.id)).toEqual(["chords", "lyrics"]);
    expect(selectChannels(doc, ["lyrics"]).channels.map((c) => c.id)).toEqual(["lyrics"]);
  });

  it("keeps the sections whatever is chosen", () => {
    expect(selectChannels(doc, []).sections).toEqual(doc.sections);
  });
});

describe("itemsAt", () => {
  const doc = buildRows(
    base({
      chords: [
        { chord: "A", beat: 0 },
        { chord: "D", beat: 20 },
      ],
      lyrics: {
        words: [
          { text: "one", startBeat: 2, endBeat: 3 },
          { text: "two", startBeat: 3, endBeat: 4 },
          { text: "three", startBeat: 30, endBeat: 31 },
        ],
        lines: [{ words: [0, 1] }, { words: [2, 2] }],
      },
    }),
  );

  it("gives each channel's current row and the item playing", () => {
    expect(itemsAt(doc, 3.2)).toEqual({ chords: { row: 0, item: 0 }, lyrics: { row: 0, item: 1 } });
    expect(itemsAt(doc, 21)).toEqual({ chords: { row: 1, item: 0 }, lyrics: { row: 0, item: -1 } });
  });

  it("keeps the last row started as current through a gap, with no item playing", () => {
    // Between the lines: "two" has let go, "three" hasn't started.
    expect(itemsAt(doc, 10).lyrics).toEqual({ row: 0, item: -1 });
  });

  it("has no row before the first one starts", () => {
    expect(itemsAt(doc, 1).lyrics).toEqual({ row: -1, item: -1 });
  });

  it("counts passes through a run, once per time through its phrase", () => {
    // A two-bar phrase (score bars 1, 2) four times over 8 bars.
    const sections = songSections([{ name: "Verse", bars: 8 }], [4, 4]);
    const bars: MappedBar[] = Array.from({ length: 8 }, (_, i) => ({ songBar: i + 1, section: 0, startBeat: i * 4, beats: 4, scoreBar: (i % 2) + 1 }));
    const doc = buildRows({
      slug: "s",
      title: "S",
      song: { timeSignature: [4, 4], sections: [{ name: "Verse", bars: 8 }] },
      charts: [{ id: "bass", kind: "tab", instrument: "bass", source: "s.gp5", track: 0, style: "chart", bars, figures: figureChart(bars, ["a", "b"], sections) }],
    });
    expect(itemsAt(doc, 0).bass).toEqual({ row: 0, item: 0, pass: 1, of: 4 });
    expect(itemsAt(doc, 7.9).bass).toEqual({ row: 0, item: 0, pass: 1, of: 4 });
    expect(itemsAt(doc, 21).bass).toEqual({ row: 0, item: 0, pass: 3, of: 4 });
    expect(itemsAt(doc, 32).bass).toEqual({ row: 0, item: -1 });
  });
});

describe("rowsFromDisplay (a song built before rows files)", () => {
  // The display a build of SONG would write: its sections, and two lines.
  const display = {
    slug: "song",
    title: "Song",
    timeSignature: [4, 4] as [number, number],
    words: [
      { text: "one", startBeat: 3, endBeat: 3.5 },
      { text: "two", startBeat: 4, endBeat: 9 },
    ],
    display: {
      sections: [
        { name: "Verse", startBeat: 0, bars: 6 },
        { name: "Break", startBeat: 24, bars: 2 },
        { name: "Bridge", startBeat: 28, bars: 3, barBeats: [4, 2, 4] },
      ],
      lines: [{ words: [0, 1] as [number, number] }],
    },
  };

  it("gets the same sections, meters included, from the display", () => {
    expect(rowsFromDisplay(display).sections.map((s) => [s.name, s.start, s.end, s.beatsPerBar, s.barBeats])).toEqual([
      ["Verse", 0, 24, 4, undefined],
      ["Break", 24, 28, 2, undefined],
      ["Bridge", 28, 38, 4, [4, 2, 4]],
    ]);
  });

  it("lays out the lyrics as a build would", () => {
    const rows = (rowsFromDisplay(display).channels[0] as any).rows;
    expect(rows.map((r: any) => [r.start, r.end, r.items.length])).toEqual([[3, 7.5, 2]]);
  });

  it("adds chords and charts from the charts file, in rows of 4 bars", () => {
    const doc = rowsFromDisplay(display, { chords: [{ chord: "A", beat: 0 }], charts: [] });
    expect(doc.channels.map((c) => c.id)).toEqual(["lyrics", "chords"]);
    expect((doc.channels[1] as any).rows[0].bars.length).toBe(4);
  });
});

describe("channelName and channelTitle", () => {
  const chart = (id: string, chart: string) => ({ id, kind: "score", chart, instrument: "x", source: "s", track: 0, rows: [] }) as any;

  it("names a channel for a display: lyrics, chords, or the part", () => {
    expect(channelName({ id: "lyrics", kind: "lyrics", rows: [] })).toBe("Lyrics");
    expect(channelName({ id: "chords", kind: "chords", rows: [] })).toBe("Chords");
    expect(channelName(chart("rhythm-guitar", "tab"))).toBe("Rhythm guitar");
  });

  it("adds how a part is drawn, for a pane's label", () => {
    expect(channelTitle(chart("rhythm-guitar", "tab"))).toBe("Rhythm guitar · tab");
    expect(channelTitle(chart("vocals", "staff"))).toBe("Vocals · notation");
    expect(channelTitle(chart("lead-guitar", "staff-tab"))).toBe("Lead guitar · notation + tab");
    expect(channelTitle(chart("drums", "drums"))).toBe("Drums");
    expect(channelTitle({ id: "lyrics", kind: "lyrics", rows: [] })).toBe("Lyrics");
  });
});
