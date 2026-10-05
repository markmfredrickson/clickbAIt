import { describe, it, expect } from "vitest";
import * as alphaTab from "@coderline/alphatab";
import { loadScore } from "../../src/charts/score-info.js";
import { doubleTime } from "../../src/charts/double-time.js";

// A score written in half time (Sugar, We're Goin Down at 82) rewritten at
// the tempo the band counts (164): every bar becomes two 4/4 bars and every
// note twice as long.

const tex = (body: string) => loadScore(new TextEncoder().encode(body), "t.atex");
const doubled = (body: string) => doubleTime(tex(body));

const GUITAR = (bars: string, head = "\\tempo 82") => `${head}\n\\track "Gtr"\n\\staff {tabs}\n${bars}`;

/** Each bar of a staff as "fret.string.duration" beats; dots as ".", ties as "~", rests as "r". */
function beats(score: alphaTab.model.Score, track = 0): string[] {
  return score.tracks[track].staves[0].bars.map((bar) =>
    bar.voices[0].beats
      .map((b) => {
        const len = `${b.duration}${".".repeat(b.dots)}`;
        if (b.isRest) return `r${len}`;
        // alphaTab numbers strings from the lowest; tab numbers them from the highest.
        const strings = bar.staff.tuning.length;
        const notes = b.notes.map((n) => `${n.isTieDestination ? "~" : ""}${n.isPercussion ? `p${n.percussionArticulation}` : `${n.fret}.${strings - n.string + 1}`}`);
        return `${notes.join("+")}:${len}`;
      })
      .join(" "),
  );
}

const meters = (score: alphaTab.model.Score) =>
  score.masterBars.map((mb) => `${mb.timeSignatureNumerator}/${mb.timeSignatureDenominator}`);

describe("doubleTime", () => {
  it("turns a 4/4 bar into two 4/4 bars and a 2/4 bar into one", () => {
    const score = doubled(GUITAR("0.6.4 0.6.4 0.6.4 0.6.4 | \\ts 2 4 0.6.4 0.6.4 | \\ts 4 4 0.6.1"));
    expect(meters(score)).toEqual(["4/4", "4/4", "4/4", "4/4", "4/4"]);
    expect(beats(score)).toEqual(["0.6:2 0.6:2", "0.6:2 0.6:2", "0.6:2 0.6:2", "0.6:1", "~0.6:1"]);
  });

  it("refuses a bar whose doubled length isn't whole 4/4 bars, naming the bar", () => {
    expect(() => doubled(GUITAR("0.6.4 0.6.4 0.6.4 0.6.4 | \\ts 3 4 0.6.4 0.6.4 0.6.4"))).toThrow(/bar 2.*3\/4/);
  });

  it("doubles every note's length and keeps its dots", () => {
    const score = doubled(GUITAR("0.6.16 0.6.16 0.6.8 0.6.4 0.6.4 {d} 0.6.8 | 0.6.32 0.6.32 0.6.16 0.6.8 0.6.4 0.6.2"));
    expect(beats(score)).toEqual(["0.6:8 0.6:8 0.6:4 0.6:2", "0.6:2. 0.6:4", "0.6:16 0.6:16 0.6:8 0.6:4 0.6:2", "0.6:1"]);
  });

  it("splits a note across the new barline and ties the second half, but only splits a rest", () => {
    const score = doubled(GUITAR("0.6.1 | 0.6.4 3.6.2 0.6.4 | r.1"));
    expect(beats(score)).toEqual(["0.6:1", "~0.6:1", "0.6:2 3.6:2", "~3.6:2 0.6:2", "r1", "r1"]);
  });

  it("keeps a note that was already tied tied", () => {
    const score = doubled(GUITAR("0.6.2 0.6.2 | -.6.4 0.6.4 0.6.2"));
    expect(beats(score)).toEqual(["0.6:1", "0.6:1", "~0.6:2 0.6:2", "0.6:1"]);
  });

  it("carries frets, strings, chords, drum hits and slides through", () => {
    const body = `\\tempo 82
\\track "Gtr"
\\staff {tabs}
(0.6 2.5 2.4).4 5.3{sl}.4 7.3.4 r.4
\\track "Drums"
\\instrument percussion
\\articulation defaults
\\staff {score}
KickHit.4 SnareHit.4 KickHit.4 SnareHit.4`;
    const source = tex(body);
    const score = doubleTime(source);
    expect(beats(score)).toEqual(["0.6+2.5+2.4:2 5.3:2", "7.3:2 r2"]);
    expect(score.tracks[0].staves[0].bars[0].voices[0].beats[1].notes[0].slideOutType).toBe(
      source.tracks[0].staves[0].bars[0].voices[0].beats[1].notes[0].slideOutType,
    );
    expect(score.tracks[0].staves[0].bars[0].voices[0].beats[1].notes[0].slideOutType).not.toBe(0);
    const drums = source.tracks[1].staves[0].bars[0].voices[0].beats.map((b) => `p${b.notes[0].percussionArticulation}`);
    expect(beats(score, 1)).toEqual([`${drums[0]}:2 ${drums[1]}:2`, `${drums[2]}:2 ${drums[3]}:2`]);
  });

  it("doubles the tempo, including a change partway through a bar", () => {
    const score = doubled(GUITAR("0.6.4 0.6.4 0.6.4 0.6.4 | 0.6.4 0.6.4 0.6.4 0.6.4 {tempo 90}"));
    expect(score.tempo).toBe(164);
    const changes = score.masterBars.flatMap((mb) =>
      mb.tempoAutomations.map((a) => ({ bar: mb.index + 1, at: a.ratioPosition, bpm: a.value })),
    );
    expect(changes).toEqual([
      { bar: 1, at: 0, bpm: 164 },
      { bar: 4, at: 0.5, bpm: 180 },
    ]);
  });

  it("puts each section marker on the first of its two bars", () => {
    const score = doubled(GUITAR('\\section "Intro" 0.6.1 | \\section "Verse" 0.6.1'));
    expect(score.masterBars.map((mb) => mb.section?.text ?? null)).toEqual(["Intro", null, "Verse", null]);
  });

  it("refuses repeats", () => {
    expect(() => doubled(GUITAR("\\ro 0.6.1 | \\rc 2 0.6.1"))).toThrow(/repeat/);
  });

  it("splits tied notes in a score read from Guitar Pro, which links them by id", () => {
    const settings = new alphaTab.Settings();
    const gp = new alphaTab.exporter.Gp7Exporter().export(tex(GUITAR("0.6.2 3.6.2 | -.6.2 0.6.2")), settings);
    const score = doubleTime(alphaTab.importer.ScoreLoader.loadScoreFromBytes(gp, settings));
    expect(beats(score)).toEqual(["0.6:1", "3.6:1", "~3.6:1", "0.6:1"]);
  });

  it("reads back the same after writing a Guitar Pro file", () => {
    const score = doubled(GUITAR('\\section "Intro" 0.6.1 | 0.6.4 3.6.2 0.6.4'));
    const settings = new alphaTab.Settings();
    const bytes = new alphaTab.exporter.Gp7Exporter().export(score, settings);
    const back = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, settings);
    expect(back.masterBars.length).toBe(4);
    expect(back.masterBars[0].section?.text).toBe("Intro");
    expect(back.tempo).toBe(164);
    expect(beats(back)).toEqual(beats(score));
  });
});
