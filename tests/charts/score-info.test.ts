import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type * as alphaTab from "@coderline/alphatab";
import { fixDrumNotes, loadScore, readScoreInfo } from "../../src/charts/score-info.js";

// A synthetic 4-bar score (no copyrighted transcription in the repo):
// guitar tab with markers "Intro" at bar 1 and "Verse" at bar 3, bass tab,
// and a drum track.
const FIXTURE = resolve(import.meta.dirname, "../fixtures/charts/three-tracks.atex");

describe("readScoreInfo", () => {
  const info = readScoreInfo(new Uint8Array(readFileSync(FIXTURE)), "three-tracks.atex");

  it("counts the score's bars", () => {
    expect(info.bars).toBe(4);
  });

  it("lists tracks in order with the kind of staff each one is", () => {
    expect(info.tracks).toEqual([
      { name: "Guitar", kind: "tab" },
      { name: "Bass", kind: "tab" },
      { name: "Drums", kind: "drums" },
    ]);
  });

  it("lists section markers with their 1-based bar numbers", () => {
    expect(info.markers).toEqual([
      { bar: 1, text: "Intro" },
      { bar: 3, text: "Verse" },
    ]);
  });

  it("gives identical bars the same signature and different bars different ones", () => {
    const [guitar, , drums] = info.signatures;
    expect(guitar[0]).toBe(guitar[1]);
    expect(guitar[2]).not.toBe(guitar[0]);
    // Drums: a kick-snare bar, then three bars of rest.
    expect(new Set(drums.slice(1)).size).toBe(1);
    expect(drums[0]).not.toBe(drums[1]);
  });

  it("rejects a file it can't read, naming the file", () => {
    expect(() => readScoreInfo(new TextEncoder().encode("not a score"), "junk.gp5")).toThrow(/junk\.gp5/);
  });
});

describe("loadScore", () => {
  // Guitar Pro 5 stores a drum track's grace notes as fretted notes, the fret
  // being the drum's MIDI number, and alphaTab reads them that way: a flam's
  // grace note comes in as fret 38 on string 3 and draws far below the staff.
  const graceAsFret = (track: alphaTab.model.Track) => {
    const note = track.staves[0].bars[0].voices[0].beats[1].notes[0];
    note.percussionArticulation = -1;
    note.fret = 38;
    note.string = 3;
    return note;
  };
  const load = () => loadScore(new Uint8Array(readFileSync(FIXTURE)), "three-tracks.atex");

  it("turns a fretted note on a drum staff back into the drum its fret names", () => {
    const score = load();
    const drums = score.tracks[2];
    const note = graceAsFret(drums);
    fixDrumNotes(score);
    expect(note.isPercussion).toBe(true);
    expect(drums.percussionArticulations[note.percussionArticulation].outputMidiNumber).toBe(38);
  });

  it("uses the MIDI number itself when the track has no articulation list, as a GP5 track doesn't", () => {
    const score = load();
    const drums = score.tracks[2];
    drums.percussionArticulations = [];
    const note = graceAsFret(drums);
    fixDrumNotes(score);
    expect(note.percussionArticulation).toBe(38);
  });

  it("leaves fretted notes on other tracks alone", () => {
    const score = load();
    const note = score.tracks[1].staves[0].bars[0].voices[0].beats[0].notes[0];
    fixDrumNotes(score);
    expect(note.isPercussion).toBe(false);
    expect(note.fret).toBe(0);
  });
});

describe("loadScore with slash repeats", () => {
  // Bar 2 repeats bar 1; bars 4–5 repeat bars 2–3 as a two-bar repeat.
  const tex = `\\title "S" . :4 3.3 5.3 7.3 8.3 | \\simile simple r.1 | \\simile none 0.6 2.6 3.6 5.6 | \\simile firstofdouble r.1 | \\simile secondofdouble r.1`;
  const score = loadScore(new TextEncoder().encode(tex), "slash.atex");
  const bars = score.tracks[0].staves[0].bars;
  const frets = (b: alphaTab.model.Bar) => b.voices[0].beats.map((x) => (x.isRest ? "r" : x.notes.map((n) => n.fret).join(""))).join(",");

  it("writes out each repeated bar in full, with no repeat mark left", () => {
    expect(bars.map(frets)).toEqual(["3,5,7,8", "3,5,7,8", "0,2,3,5", "3,5,7,8", "0,2,3,5"]);
    expect(bars.every((b) => b.simileMark === 0)).toBe(true);
  });

  it("gives the repeated bars the signature of the bars they repeat", () => {
    const [sig] = readScoreInfo(new TextEncoder().encode(tex), "slash.atex").signatures;
    expect(sig[1]).toBe(sig[0]);
    expect(sig[3]).toBe(sig[1]);
    expect(sig[4]).toBe(sig[2]);
  });
});
