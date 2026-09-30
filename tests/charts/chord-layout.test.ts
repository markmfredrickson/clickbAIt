import { describe, it, expect } from "vitest";
import { layoutChords, currentChord, followTarget, type LayoutInput } from "../../src/charts/chord-layout.js";

// Intro (2 bars, no lyrics), Verse (2 bars, two lines), Turn (1 bar of 3/4,
// no lyrics), Solo (1 bar, one line sung late). Sections start at beats 0,
// 8, 16 and 19.
const INPUT: LayoutInput = {
  sections: [
    { name: "Intro", startBeat: 0, bars: 2, beatsPerBar: 4 },
    { name: "Verse", startBeat: 8, bars: 2, beatsPerBar: 4 },
    { name: "Turn", startBeat: 16, bars: 1, beatsPerBar: 3 },
    { name: "Solo", startBeat: 19, bars: 1, beatsPerBar: 4 },
  ],
  words: [{ startBeat: 8.5 }, { startBeat: 10 }, { startBeat: 13 }, { startBeat: 14 }, { startBeat: 22.9 }],
  lines: [
    { words: [0, 1], sectionIndex: 1 },
    { words: [2, 3], sectionIndex: 1 },
    { words: [4, 4], sectionIndex: 3 },
  ],
  chords: [
    { chord: "A", beat: 0 }, // 0  Intro, nothing sung
    { chord: "D", beat: 2 }, // 1
    { chord: "E", beat: 4 }, // 2
    { chord: "F", beat: 8 }, // 3  sounding when word 0 is sung
    { chord: "G", beat: 10 }, // 4  on word 1
    { chord: "C", beat: 11 }, // 5  between the lines: a walkdown
    { chord: "Bb", beat: 11.5 }, // 6
    { chord: "Am", beat: 13 }, // 7  on word 2
    { chord: "D", beat: 16 }, // 8  Turn, after the last word
    { chord: "E", beat: 19 }, // 9  Solo, before its word
    { chord: "A", beat: 21 }, // 10 on word 4
  ],
};

describe("layoutChords", () => {
  const layout = layoutChords(INPUT);

  it("puts a chord over the word sung nearest it before the next chord", () => {
    expect(layout.overWord).toEqual({ 0: 3, 1: 4, 2: 7, 4: 10 });
  });

  it("gives a chord a word sung up to half a beat before it, but no earlier", () => {
    const words = [{ startBeat: 7.6 }, { startBeat: 10 }, { startBeat: 13 }, { startBeat: 14 }];
    expect(layoutChords({ ...INPUT, words }).overWord[0]).toBe(3);
    const early = [{ startBeat: 7.4 }, { startBeat: 10 }, { startBeat: 13 }, { startBeat: 14 }];
    expect(layoutChords({ ...INPUT, words: early }).overWord[0]).not.toBe(3);
  });

  it("uses each word once, in order", () => {
    // G (10) and C (11) are both nearest word 1; G takes it, C looks later.
    expect(layout.overWord[1]).toBe(4);
    expect(Object.values(layout.overWord).filter((c) => c === 5)).toEqual([]);
  });

  it("gathers chords nothing is sung under into rows of bars, with each chord's place in its bar", () => {
    expect(layout.rows.map((r) => r.bars)).toEqual([
      [
        { startBeat: 0, beats: 4, chords: [{ chord: 0, at: 0 }, { chord: 1, at: 0.5 }] },
        { startBeat: 4, beats: 4, chords: [{ chord: 2, at: 0 }] },
      ],
      [{ startBeat: 8, beats: 4, chords: [{ chord: 5, at: 0.75 }, { chord: 6, at: 0.875 }] }],
      // The row runs into the Solo, whose bars are 4/4.
      [
        { startBeat: 16, beats: 3, chords: [{ chord: 8, at: 0 }] },
        { startBeat: 19, beats: 4, chords: [{ chord: 9, at: 0 }] },
      ],
    ]);
  });

  it("starts a new row where a section with no lyrics begins", () => {
    // Bb follows the Verse's last word; D starts the Turn, which has no lyrics.
    const chords = [...INPUT.chords.slice(0, 8), { chord: "Bb", beat: 15 }, ...INPUT.chords.slice(8)];
    const rows = layoutChords({ ...INPUT, chords }).rows;
    expect(rows.slice(2).map((r) => [r.label ?? null, r.firstBeat])).toEqual([[null, 15], ["Turn", 16]]);
  });

  it("places each row before the first lyric line that starts after it", () => {
    expect(layout.rows.map((r) => r.beforeLine)).toEqual([0, 1, 2]);
  });

  it("labels a row that starts a section with no lyrics, and only that", () => {
    expect(layout.rows.map((r) => r.label ?? null)).toEqual(["Intro", null, "Turn"]);
  });

  it("records each row's first chord and which row holds each chord", () => {
    expect(layout.rows.map((r) => r.firstBeat)).toEqual([0, 11, 16]);
    expect(layout.rowOfChord).toEqual({ 0: 0, 1: 0, 2: 0, 5: 1, 6: 1, 8: 2, 9: 2 });
  });

  it("is empty for a song with no chords", () => {
    expect(layoutChords({ ...INPUT, chords: [] })).toEqual({ overWord: {}, rows: [], rowOfChord: {} });
  });
});

describe("currentChord", () => {
  it("is the last chord at or before the beat, or -1 before the first", () => {
    expect([-1, 0, 10.5, 100].map((b) => currentChord(INPUT.chords, b))).toEqual([-1, 0, 4, 10]);
  });
});

describe("followTarget", () => {
  const layout = layoutChords(INPUT);
  const at = (beat: number) => followTarget(layout, INPUT, beat);

  it("follows a chord row while its chords play and nothing is being sung", () => {
    expect(at(5)).toEqual({ row: 0 });
    expect(at(11.2)).toEqual({ row: 1 });
    expect(at(17)).toEqual({ row: 2 });
  });

  it("follows the sung line otherwise", () => {
    expect(at(9)).toEqual({ line: 0 });
    expect(at(13.5)).toEqual({ line: 1 });
  });

  it("follows nothing before the song starts", () => {
    expect(at(-2)).toBeNull();
  });
});
