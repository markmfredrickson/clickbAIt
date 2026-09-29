import { describe, it, expect } from "vitest";
import { blocksFrom, assemblePages, pageAt, lineAt, type Block } from "../../src/teleprompter/eink/layout.js";
import type { LyricsDisplay } from "../../src/teleprompter/lyrics-display.js";

/** A LyricsDisplay from sections and one-word lines. Placeholder text only. */
function song(
  sections: [name: string, startBeat: number][],
  lines: { beat: number; section?: string; text?: string; tag?: string }[],
  beatsPerBar = 4,
): LyricsDisplay {
  return {
    schema: "clickbait/lyrics-display@1",
    title: "Test Song",
    bpm: 120,
    timeSignature: [beatsPerBar, 4],
    slug: "test-song",
    curve: [{ t: 0, b: 0 }, { t: 0.5, b: 1 }],
    words: lines.map((l, i) => ({ text: l.text ?? `w${i}`, startBeat: l.beat, endBeat: l.beat + 1 })),
    display: {
      sections: sections.map(([name, startBeat]) => ({ name, startBeat })),
      lines: lines.map((l, i) => ({ words: [i, i] as [number, number], section: l.section, tag: l.tag })),
    },
  };
}

/** Compact view: "[Name]" for a header, the beat for a line. */
const shape = (blocks: Block[]) => blocks.map((b) => (b.kind === "section" ? `[${b.text}]` : b.beat));

describe("blocksFrom", () => {
  it("keeps a pickup line with its own section, not the one before", () => {
    // Sung a beat before the verse's downbeat — sorting by beat would put it in the intro.
    const s = song([["Intro", 0], ["Verse", 64]], [{ beat: 63, section: "Verse" }, { beat: 72, section: "Verse" }]);
    expect(shape(blocksFrom(s))).toEqual(["[Intro]", "[Verse]", 63, 72]);
  });

  it("sends lines of a repeated section name to the right occurrence", () => {
    const s = song(
      [["Chorus", 0], ["Verse", 32], ["Chorus", 64]],
      [
        { beat: 1, section: "Chorus" },
        { beat: 33, section: "Verse" },
        { beat: 63, section: "Chorus" },
        { beat: 70, section: "Chorus" },
      ],
    );
    expect(shape(blocksFrom(s))).toEqual(["[Chorus]", 1, "[Verse]", 33, "[Chorus]", 63, 70]);
  });

  it("follows the label when a line starts well before its section", () => {
    // A mis-aligned early line still belongs where the manifest says.
    const s = song([["Chorus", 0], ["Bridge", 64]], [{ beat: 10, section: "Chorus" }, { beat: 46, section: "Bridge" }]);
    expect(shape(blocksFrom(s))).toEqual(["[Chorus]", 10, "[Bridge]", 46]);
  });

  it("places an unlabelled line in the section its beat falls in", () => {
    const s = song([["Intro", 0], ["Verse", 16]], [{ beat: 4 }, { beat: 20 }]);
    expect(shape(blocksFrom(s))).toEqual(["[Intro]", 4, "[Verse]", 20]);
  });

  it("keeps a section with no lines, with its length in bars", () => {
    const s = song([["Verse", 0], ["Guitar Solo", 32], ["Chorus", 96]], [{ beat: 1, section: "Verse" }, { beat: 97, section: "Chorus" }]);
    const solo = blocksFrom(s).find((b) => b.text === "Guitar Solo")!;
    expect(solo.kind).toBe("section");
    expect(solo.bars).toBe(16);
  });

  it("uses authored bar counts when the song has them, including the last section", () => {
    const s = song([["Chorus", 0], ["Outro", 32]], [{ beat: 1, section: "Chorus" }]);
    s.display.sections[0].bars = 8;
    s.display.sections[1].bars = 6;
    const bars = blocksFrom(s).filter((b) => b.kind === "section").map((b) => b.bars);
    expect(bars).toEqual([8, 6]);
  });

  it("gives the last section no bar count when an older build didn't record it", () => {
    // An instrumental outro starts after the last word — measuring to that word gave "0 bars".
    const s = song([["Chorus", 0], ["Outro", 32]], [{ beat: 1, section: "Chorus" }, { beat: 20, section: "Chorus" }]);
    const outro = blocksFrom(s).find((b) => b.text === "Outro")!;
    expect(outro.bars).toBeUndefined();
  });

  it("ends a line half a beat after its last word, holding that word 1–3 beats", () => {
    const s: LyricsDisplay = { ...song([["Verse", 0]], []) };
    s.words = [
      { text: "a", startBeat: 1, endBeat: 2 },
      { text: "b", startBeat: 10, endBeat: 10.2 }, // short: held 1 beat
      { text: "c", startBeat: 20, endBeat: 22 }, // normal: held as sung
      { text: "d", startBeat: 30, endBeat: 45 }, // end stretched into silence: capped at 3
    ];
    s.display.lines = [
      { words: [0, 1], section: "Verse" },
      { words: [2, 2], section: "Verse" },
      { words: [3, 3], section: "Verse" },
    ];
    expect(blocksFrom(s).slice(1).map((b) => b.endBeat)).toEqual([11.5, 22.5, 33.5]);
  });

  it("joins a line's words and carries its tag", () => {
    const s: LyricsDisplay = {
      ...song([["Verse", 0]], []),
      words: [
        { text: "one", startBeat: 1, endBeat: 2 },
        { text: "two,", startBeat: 2, endBeat: 3 },
      ],
    };
    s.display.lines = [{ words: [0, 1], section: "Verse", tag: "Backing Vocal" }];
    const line = blocksFrom(s)[1];
    expect(line).toMatchObject({ kind: "line", beat: 1, text: "one two,", tag: "Backing Vocal" });
  });
});

describe("assemblePages", () => {
  const blocks: Block[] = [
    { kind: "section", beat: 0, text: "Intro", bars: 16 },
    { kind: "section", beat: 64, text: "Verse", bars: 16 },
    { kind: "line", beat: 63, endBeat: 68, text: "a" },
    { kind: "line", beat: 72, endBeat: 78, text: "b" },
  ];

  it("starts a page at its earliest beat, so a pickup line under a header counts", () => {
    const pages = assemblePages(blocks, [
      { blocks: [0], geometry: [{ y: 0, h: 40 }] },
      { blocks: [1, 2, 3], geometry: [{ y: 0, h: 40 }, { y: 40, h: 50 }, { y: 90, h: 50 }] },
    ]);
    expect(pages.map((p) => p.startBeat)).toEqual([0, 63]);
  });

  it("lists only lines (not headers) with their beat and position", () => {
    const pages = assemblePages(blocks, [
      { blocks: [0, 1, 2, 3], geometry: [{ y: 0, h: 40 }, { y: 40, h: 40 }, { y: 80, h: 50 }, { y: 130, h: 50 }] },
    ]);
    expect(pages[0].lines).toEqual([
      { beat: 63, endBeat: 68, y: 80, h: 50 },
      { beat: 72, endBeat: 78, y: 130, h: 50 },
    ]);
  });
});

describe("pageAt", () => {
  const pages = [{ startBeat: 0 }, { startBeat: 63 }, { startBeat: 128 }];

  it("turns one lead before the next page's first beat", () => {
    expect(pageAt(pages, 58.9, 4)).toBe(0);
    expect(pageAt(pages, 59, 4)).toBe(1);
  });

  it("shows the first page before the song starts", () => {
    expect(pageAt(pages, -8, 4)).toBe(0);
  });

  it("stays on the last page past the end", () => {
    expect(pageAt(pages, 10_000, 4)).toBe(2);
  });
});

describe("lineAt", () => {
  const lines = [{ beat: 8, endBeat: 12 }, { beat: 16, endBeat: 20 }];

  it("lights a line one lookahead before it is sung", () => {
    expect(lineAt(lines, 6.9, 1)).toBe(-1);
    expect(lineAt(lines, 7, 1)).toBe(0);
    expect(lineAt(lines, 15, 1)).toBe(1);
  });

  it("goes dark when a line ends, so it doesn't stay lit through a solo", () => {
    expect(lineAt(lines, 11.9, 1)).toBe(0);
    expect(lineAt(lines, 12, 1)).toBe(-1);
    expect(lineAt(lines, 100, 1)).toBe(-1);
  });

  it("hands straight to the next line when it starts before the last one ends", () => {
    const tight = [{ beat: 8, endBeat: 17 }, { beat: 16, endBeat: 20 }];
    expect(lineAt(tight, 15, 1)).toBe(1);
  });

  it("has nothing lit on a page with no lines", () => {
    expect(lineAt([], 50, 1)).toBe(-1);
  });
});
