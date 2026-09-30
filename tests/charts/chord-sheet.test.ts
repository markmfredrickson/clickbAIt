import { describe, it, expect } from "vitest";
import { parseChordSheet, placeChords } from "../../src/charts/chord-sheet.js";
import { songSections } from "../../src/charts/bar-map.js";

// A short song: Intro (2 bars), Verse (2 bars), Turn (1 bar of 3/4), Solo
// (2 bars), Intro again (1 bar). 4/4 elsewhere, so the sections start at
// beats 0, 8, 16, 19 and 27.
const SECTIONS = songSections(
  [
    { name: "Intro", bars: 2 },
    { name: "Verse", bars: 2 },
    { name: "Turn", bars: 1, timeSignature: [3, 4] },
    { name: "Solo", bars: 2 },
    { name: "Intro", bars: 1 },
  ],
  [4, 4],
);
// The sung words, as the lyrics display has them.
const WORDS = [
  { text: "Alpha", startBeat: 8 },
  { text: "bravo,", startBeat: 9.5 },
  { text: "'charlie", startBeat: 12 },
  { text: "delta", startBeat: 14 },
];
const SONG = { sections: SECTIONS, words: WORDS };

/** Lines of a sheet, joined. */
const sheet = (...lines: string[]) => lines.join("\n");
const VERSE = ["[Verse]", "C      G", "alpha bravo", "     F", "charlie delta"];

describe("parseChordSheet", () => {
  it("sorts lines into headers, chords over lyrics, and instrumental chord lines", () => {
    const parsed = parseChordSheet(sheet("", "[Intro]", "C G F C", "", ...VERSE));
    expect(parsed).toEqual([
      { kind: "header", line: 2, name: "Intro" },
      { kind: "instrumental", line: 3, chords: ["C", "G", "F", "C"] },
      { kind: "header", line: 5, name: "Verse" },
      { kind: "lyric", line: 7, text: "alpha bravo", chords: [{ chord: "C", col: 0 }, { chord: "G", col: 7 }] },
      { kind: "lyric", line: 9, text: "charlie delta", chords: [{ chord: "F", col: 5 }] },
    ]);
  });

  it("treats a chord line followed by a blank, a header or another chord line as instrumental", () => {
    const parsed = parseChordSheet(sheet("[Intro]", "C G", "F", "", "Am", "[Verse]", "alpha"));
    expect(parsed.map((l) => l.kind)).toEqual(["header", "instrumental", "instrumental", "instrumental", "header", "lyric"]);
  });

  it("gives a lyric line with no chord line above it no chords", () => {
    expect(parseChordSheet("alpha bravo")).toEqual([{ kind: "lyric", line: 1, text: "alpha bravo", chords: [] }]);
  });

  it("reads a line with a word that isn't a chord as lyrics, even if it starts with one", () => {
    expect(parseChordSheet("A fool")[0].kind).toBe("lyric");
  });

  it("reads chord names with qualities, extensions and bass notes", () => {
    const parsed = parseChordSheet("Amaj7 F#m7 E/G# C#m Bbsus4 Gadd9 Ddim N.C.");
    expect(parsed[0]).toMatchObject({
      kind: "instrumental",
      chords: ["Amaj7", "F#m7", "E/G#", "C#m", "Bbsus4", "Gadd9", "Ddim", "N.C."],
    });
  });

  it("splits a line with bar lines into bars", () => {
    expect(parseChordSheet("| E | C#m D | Bm |")[0]).toEqual({
      kind: "instrumental",
      line: 1,
      chords: ["E", "C#m", "D", "Bm"],
      bars: [["E"], ["C#m", "D"], ["Bm"]],
    });
  });
});

describe("placeChords", () => {
  const place = (text: string) => placeChords(text, SONG);
  const beats = (text: string) => {
    const { chords, errors } = place(text);
    expect(errors).toEqual([]);
    return chords.map((c) => [c.chord, c.beat]);
  };

  it("puts a chord in the bar its word is sung in, and records the word", () => {
    const { chords } = place(sheet(...VERSE));
    expect(chords[0]).toEqual({ chord: "C", beat: 8, line: 2, word: 0 });
    // C and G are both sung in the Verse's first bar, so they split it.
    expect(chords.map((c) => [c.chord, c.beat, c.word])).toEqual([["C", 8, 0], ["G", 10, 1], ["F", 12, 2]]);
  });

  it("gives a chord over a space the next word", () => {
    expect(place(sheet("[Verse]", "     G", "alpha bravo charlie delta")).chords.map((c) => c.word)).toEqual([1]);
  });

  it("splits a bar evenly among all the chords sung in it", () => {
    const words = [
      { text: "alpha", startBeat: 8 },
      { text: "bravo", startBeat: 9 },
      { text: "charlie", startBeat: 10.5 },
    ];
    const { chords } = placeChords(sheet("[Verse]", "C     G     F", "alpha bravo charlie"), { sections: SECTIONS, words });
    expect(chords.map((c) => [c.chord, c.beat])).toEqual([["C", 8], ["G", 8 + 4 / 3], ["F", 8 + 8 / 3]]);
  });

  it("moves a chord sung in a bar's last beat to the next bar", () => {
    // Anticipation: "bravo" comes in just before the Verse's second bar.
    const words = [
      { text: "alpha", startBeat: 8 },
      { text: "bravo", startBeat: 11.5 },
    ];
    const { chords } = placeChords(sheet("[Verse]", "C     G", "alpha bravo"), { sections: SECTIONS, words });
    expect(chords.map((c) => [c.chord, c.beat])).toEqual([["C", 8], ["G", 12]]);
  });

  it("puts a chord past the end of the lyrics half a bar after the chord before it", () => {
    expect(beats(sheet("[Verse]", "C             G  F", "alpha bravo", "charlie delta"))).toEqual([
      ["C", 8],
      ["G", 10],
      ["F", 12],
    ]);
  });

  it("starts an instrumental line at its section's first beat, half a bar per chord, across lines", () => {
    expect(beats(sheet("[Intro]", "C G", "F C", "", ...VERSE))).toEqual([
      ["C", 0], ["G", 2], ["F", 4], ["C", 6],
      ["C", 8], ["G", 10], ["F", 12],
    ]);
  });

  it("uses the meter at each chord for half a bar", () => {
    // Turn is 3/4, so its half bar is 1.5 beats.
    expect(beats(sheet(...VERSE, "[Turn]", "A B C"))).toEqual([
      ["C", 8], ["G", 10], ["F", 12],
      ["A", 16], ["B", 17.5], ["C", 19],
    ]);
  });

  it("splits each bar evenly among its chords, in the meter of the bar's section", () => {
    // One 3/4 bar of Turn, then Solo's two 4/4 bars.
    expect(beats(sheet(...VERSE, "[Turn]", "| A B C | D | E F |"))).toEqual([
      ["C", 8], ["G", 10], ["F", 12],
      ["A", 16], ["B", 17], ["C", 18], ["D", 19], ["E", 23], ["F", 25],
    ]);
  });

  it("starts a line of bars after lyrics on the next bar", () => {
    // A walkdown between lyric lines: C on "alpha" and G on "bravo" split the
    // first bar, so the bars start on the second one (12), a quarter each.
    expect(beats(sheet("[Verse]", "C     G", "alpha bravo", "", "| F E D C |", "", "charlie delta"))).toEqual([
      ["C", 8], ["G", 10], ["F", 12], ["E", 13], ["D", 14], ["C", 15],
    ]);
  });

  it("maps the second header with a name to the second section with that name", () => {
    expect(beats(sheet("[Intro]", "C", ...VERSE, "[Intro]", "G"))).toEqual([
      ["C", 0], ["C", 8], ["G", 10], ["F", 12], ["G", 27],
    ]);
  });

  it("matches words ignoring case, punctuation and apostrophes, whatever the line breaks", () => {
    expect(beats(sheet("[Verse]", "C", "Alpha", "      F", "bravo charlie", "delta!"))).toEqual([["C", 8], ["F", 12]]);
  });

  describe("errors", () => {
    const errors = (text: string) => place(text).errors;

    it("names the sheet line and both words when the lyrics differ", () => {
      expect(errors(sheet("[Verse]", "alpha bravo", "charlie echo"))).toEqual([
        'line 3: the sheet has "echo" where the song sings "delta" (word 4)',
      ]);
    });

    it("reports sheet lyrics past the song's last word", () => {
      expect(errors(sheet(...VERSE, "echo foxtrot"))).toEqual([
        "line 6: the sheet's lyrics go on after the song's last sung word",
      ]);
    });

    it("reports a sheet that stops before the song's last word", () => {
      expect(errors(sheet("[Verse]", "alpha bravo"))).toEqual([
        "the sheet's lyrics stop after word 2 of the song's 4",
      ]);
    });

    it("reports an instrumental line under a header that names no section", () => {
      expect(errors(sheet("[Sax Solo]", "C G", ...VERSE))).toEqual([
        'line 1: no section "Sax Solo" (the song has Intro, Verse, Turn, Solo)',
      ]);
    });

    it("reports a header used more times than the song has that section", () => {
      expect(errors(sheet(...VERSE, "[Verse]", "C"))).toEqual(['line 6: the song has only 1 "Verse" section']);
    });

    it("reports an instrumental line with nothing before it to place it", () => {
      expect(errors(sheet("C G", ...VERSE))).toEqual(["line 1: chords with no lyrics under them need a [Section] header first"]);
    });

    it("reports bar lines over lyrics", () => {
      expect(errors(sheet("[Verse]", "| C | G |", "alpha bravo charlie delta"))).toEqual([
        "line 2: bar lines only work on a line of chords with no lyrics under it",
      ]);
    });

    it("reports chords that would land out of order", () => {
      // F is on "charlie" (12); G and A chain to 14 and 16, where Turn's B also lands.
      expect(errors(sheet(...VERSE.slice(0, 3), "     F         G A", "charlie delta", "[Turn]", "B"))).toEqual([
        'line 7: "B" lands at beat 16, not after "A" (line 4, beat 16)',
      ]);
    });

    it("reports a chord sung in a bar that chords before it already reach", () => {
      // C is on "alpha" (8); G has no word, so it goes at 10; F's word "bravo"
      // is sung in the same bar, which now has G in it.
      expect(errors(sheet("[Verse]", "C       G", "alpha", "F", "bravo charlie delta"))).toEqual([
        'line 4: "F" is sung in the bar at beat 8, but "G" (line 2) is already at beat 10',
      ]);
    });

    it("reports every problem at once", () => {
      expect(errors(sheet("C", "[Sax Solo]", "G", "[Verse]", "alpha bravo", "charlie echo"))).toHaveLength(3);
    });
  });
});
