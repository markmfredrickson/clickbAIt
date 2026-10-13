import { describe, it, expect } from "vitest";
import * as alphaTab from "@coderline/alphatab";
import { loadScore } from "../../src/charts/score-info.js";
import { transposeScore } from "../../src/charts/transpose-score.js";

// A score transcribed in the record's key, moved to the key the band plays.
// Tab is re-fretted, so every note stays playable on the same instrument.

const tex = (body: string) => loadScore(new TextEncoder().encode(body), "t.atex");
const GUITAR = (notes: string, head = "") => `${head}\\track "Gtr"\n\\staff {tabs}\n${notes}`;
const BASS = (notes: string) => `\\track "Bass"\n\\staff {tabs}\n\\tuning G2 D2 A1 E1\n${notes}`;

/** Each note of the first bar as "fret.string", strings numbered as in tab (1 = highest). */
function frets(score: alphaTab.model.Score, track = 0): string[] {
  const bar = score.tracks[track].staves[0].bars[0];
  const strings = bar.staff.tuning.length;
  return bar.voices[0].beats.flatMap((b) => b.notes.map((n) => `${n.fret}.${strings - n.string + 1}`));
}

describe("transposeScore", () => {
  it("moves a note down on its own string when the fret allows", () => {
    expect(frets(transposeScore(tex(GUITAR("7.3.4")), -4))).toEqual(["3.3"]);
  });

  it("moves a note that would go below fret 0 to the next lower string, same pitch", () => {
    // B2 (A string, fret 2) down 4 is G2: low E string, fret 3.
    expect(frets(transposeScore(tex(GUITAR("2.5.4")), -4))).toEqual(["3.6"]);
  });

  it("raises a note below the lowest open string by an octave", () => {
    // Bass F#1 (E string, fret 2) down 4 is D1, under the open E: it plays D2 instead.
    expect(frets(transposeScore(tex(BASS("2.4.4")), -4))).toEqual(["10.4"]);
  });

  it("moves a note past the top fret to the next higher string, same pitch", () => {
    // A5 (B string, fret 22) up 5 is D6: high E string, fret 22.
    expect(frets(transposeScore(tex(GUITAR("22.2.4")), 5))).toEqual(["22.1"]);
  });

  it("leaves drum tracks alone", () => {
    const body = `${GUITAR("7.3.4")}
\\track "Drums"
\\instrument percussion
\\articulation defaults
\\staff {score}
KickHit.4`;
    const before = tex(body).tracks[1].staves[0].bars[0].voices[0].beats[0].notes[0].percussionArticulation;
    const after = transposeScore(tex(body), -4).tracks[1].staves[0].bars[0].voices[0].beats[0].notes[0];
    expect(after.percussionArticulation).toBe(before);
  });

  it("moves the key signature with the notes", () => {
    const score = transposeScore(tex(GUITAR("7.3.4", "\\ks Db\n")), -4);
    expect(score.masterBars[0].keySignature).toBe(3); // A: three sharps
  });
});
