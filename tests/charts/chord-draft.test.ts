import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { draftLab, writeNewFile } from "../../src/charts/chord-draft.js";
import { parseLab } from "../../src/charts/lab.js";
import { chordName } from "../../src/charts/chord-label.js";
import { chordBeats, type ChordTiming } from "../../src/charts/chord-timeline.js";
import { songSections } from "../../src/charts/bar-map.js";
import { beatMapCurve } from "../../src/core/beat-map.js";

// Intro (2 bars) and Verse (2 bars) in 4/4: beats 0 and 8, ending at 16.
const SECTIONS = songSections([{ name: "Intro", bars: 2 }, { name: "Verse", bars: 2 }], [4, 4]);
const WORDS = [
  { text: "alpha", startBeat: 8 },
  { text: "bravo", startBeat: 9.5 },
  { text: "charlie", startBeat: 12 },
];
const SHEET = ["[Intro]", "A D F#m7 G", "[Verse]", "E/G#   Bm", "alpha bravo", "Amaj7", "charlie"].join("\n");
// 60 bpm, one beat per second; clips shift where the song's beats come from.
const timing = (clips?: ChordTiming["clips"]): ChordTiming => ({
  curve: beatMapCurve([{ startBeat: 0, times: Array.from({ length: 40 }, (_, i) => i) }], 60),
  clips,
  offset: 0,
  bpm: 60,
});
const song = { sections: SECTIONS, words: WORDS };

describe("draftLab", () => {
  it("writes each chord's start and end in source seconds, with Harte labels", () => {
    const { text, errors } = draftLab(SHEET, song, timing(), { comment: "drafted" });
    expect(errors).toEqual([]);
    expect(parseLab(text!).segments.map((s) => [s.start, s.end, s.label])).toEqual([
      [0, 2, "A:maj"],
      [2, 4, "D:maj"],
      [4, 6, "F#:min7"],
      [6, 8, "G:maj"],
      [8, 10, "E:maj/3"],
      [10, 12, "B:min"],
      // The last chord lasts to the end of the song.
      [12, 16, "A:maj7"],
    ]);
  });

  it("reads back as the sheet's chords on the same beats", () => {
    const t = timing([{ from: 3, seconds: 20 }]);
    const { text } = draftLab(SHEET, song, t, { comment: "drafted" });
    const { segments } = parseLab(text!);
    const back = chordBeats(segments, t).map(({ segment, beat }) => [chordName(segments[segment].label), beat]);
    expect(back).toEqual([
      ["A", 0], ["D", 2], ["F#m7", 4], ["G", 6], ["E/G#", 8], ["Bm", 10], ["Amaj7", 12],
    ]);
  });

  it("goes through the clips to the source time", () => {
    const { text } = draftLab(SHEET, song, timing([{ from: 3, seconds: 20 }]), { comment: "drafted" });
    expect(parseLab(text!).segments[0]).toMatchObject({ start: 3, end: 5 });
  });

  it("returns the sheet's problems and no file", () => {
    const { text, errors } = draftLab(SHEET.replace("bravo", "echo"), song, timing(), { comment: "drafted" });
    expect(text).toBeUndefined();
    expect(errors).toEqual(['line 5: the sheet has "echo" where the song sings "bravo" (word 2)']);
  });

  it("reports a chord on a beat that plays no audio", () => {
    const { errors } = draftLab(SHEET, song, timing([{ silence: 2 }, { from: 3, seconds: 20 }]), { comment: "drafted" });
    expect(errors).toEqual(['line 2: "A" at beat 0 plays no audio (silence, or past the last clip)']);
  });
});

describe("writeNewFile", () => {
  it("writes a new file and refuses to replace one that exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "chord-draft-"));
    try {
      const path = join(dir, "song.chords.lab");
      writeNewFile(path, "first\n");
      expect(readFileSync(path, "utf8")).toBe("first\n");
      expect(() => writeNewFile(path, "second\n")).toThrow(/already exists/);
      expect(readFileSync(path, "utf8")).toBe("first\n");
      writeNewFile(path, "second\n", { force: true });
      expect(readFileSync(path, "utf8")).toBe("second\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
