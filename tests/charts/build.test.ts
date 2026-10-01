import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildChartsFile } from "../../src/charts/build.js";
import type { ChartSpec, ScoreSpec } from "../../src/manifest.js";
import type { ChordTiming } from "../../src/charts/chord-timeline.js";
import { beatMapCurve } from "../../src/core/beat-map.js";

// The 4-bar fixture score: Intro (bars 1–2) and Verse (bars 3–4) markers,
// tracks Guitar, Bass, Drums.
const FIXTURE = readFileSync(resolve(import.meta.dirname, "../fixtures/charts/three-tracks.atex"));

const song = (scores: ScoreSpec[], charts: ChartSpec[]) => ({
  title: "Fixture",
  artist: "Test",
  timeSignature: [4, 4] as [number, number],
  sections: [{ name: "Intro", bars: 2 }, { name: "Verse", bars: 2 }, { name: "Verse", bars: 2 }],
  scores,
  charts,
});
const fixture: ScoreSpec = {
  id: "fixture",
  file: "fixture.atex",
  sections: [{ section: "Intro", bars: [1, 2] }, { section: "Verse", bars: [3, 4] }],
};
const guitar: ChartSpec = { id: "guitar", kind: "tab", instrument: "guitar", score: "fixture", track: 0 };
const bass: ChartSpec = { id: "bass", kind: "tab", instrument: "bass", score: "fixture", track: 1 };
const files = (name: string) => {
  if (name === "fixture.atex") return new Uint8Array(FIXTURE);
  throw new Error(`ENOENT: ${name}`);
};

describe("buildChartsFile", () => {
  it("maps each chart's bars through its score and records the song's sections", () => {
    const out = buildChartsFile(song([fixture], [guitar, bass]), files);
    expect(out.schema).toBe("clickbait/charts@1");
    expect(out.slug).toBe("fixture-test");
    expect(out.sections.map((s) => [s.name, s.occurrence, s.startBeat])).toEqual([["Intro", 1, 0], ["Verse", 1, 8], ["Verse", 2, 16]]);
    expect(out.charts.map((c) => [c.id, c.trackName, c.source])).toEqual([["guitar", "Guitar", "fixture.atex"], ["bass", "Bass", "fixture.atex"]]);
    expect(out.charts[0]).toMatchObject({ kind: "tab", instrument: "guitar", score: "fixture", track: 0 });
    // Both tracks share the score's bars.
    expect(out.charts[0].bars.map((b) => b.scoreBar)).toEqual([1, 2, 3, 4, 3, 4]);
    expect(out.charts[1].bars).toEqual(out.charts[0].bars);
  });

  it("names a score file it can't find", () => {
    expect(() => buildChartsFile(song([{ ...fixture, file: "missing.gp5" }], [guitar]), files)).toThrow(/missing\.gp5/);
  });

  it("reports a track the score doesn't have", () => {
    expect(() => buildChartsFile(song([fixture], [{ ...guitar, track: 9 }]), files)).toThrow(/guitar.*track 9/);
  });

  it("reports every problem at once, not just the first", () => {
    const pastEnd: ScoreSpec = { id: "past-end", file: "fixture.atex", sections: [{ section: "Intro", bars: [7, 8] }] };
    let message = "";
    try {
      buildChartsFile(song([fixture, pastEnd], [{ ...guitar, track: 9 }, { ...bass, score: "past-end" }]), files);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/guitar.*track 9/);
    expect(message).toMatch(/past-end.*score ends at bar 4/);
  });

  it("reads each score file once, however many charts use it", () => {
    let reads = 0;
    const counting = (name: string) => {
      reads++;
      return files(name);
    };
    buildChartsFile(song([fixture], [guitar, bass]), counting);
    expect(reads).toBe(1);
  });

  it("writes a chart-style part as figure letters: the fixture's drums play a beat, then rest", () => {
    const drums: ChartSpec = { id: "drums", kind: "drums", instrument: "drums", score: "fixture", track: 2 };
    const out = buildChartsFile(song([fixture], [drums]), files);
    expect(out.charts[0].style).toBe("chart");
    const figures = out.charts[0].figures!;
    expect(figures.sections.map((sec) => sec.runs.map((r) => `${r.letters.join(" ")}×${r.count}`))).toEqual([["A×1", "B×1"], ["B×2"], ["B×2"]]);
  });

  it("draws as scores the sections the manifest names, and those where no bar repeats", () => {
    const drums: ChartSpec = { id: "drums", kind: "drums", instrument: "drums", score: "fixture", track: 2 };
    // The Intro plays a beat then a rest bar, two different bars: drawn as a score unasked.
    expect(buildChartsFile(song([fixture], [drums]), files).charts[0].sectionsAsScore).toEqual([0]);
    const named = buildChartsFile(song([fixture], [{ ...drums, scoreSections: ["Verse"] }]), files).charts[0];
    expect(named.sectionsAsScore).toEqual([0, 1, 2]);
  });

  it("gives a score-style part its style and no figures", () => {
    const out = buildChartsFile(song([fixture], [{ ...guitar, style: "score" }]), files);
    expect(out.charts[0].style).toBe("score");
    expect(out.charts[0].figures).toBeUndefined();
  });

  it("skips a score no chart uses", () => {
    const unused: ScoreSpec = { ...fixture, id: "unused", file: "missing.gp5" };
    expect(() => buildChartsFile(song([fixture, unused], [guitar]), files)).not.toThrow();
  });
});

describe("buildChartsFile — chords", () => {
  // 60 bpm, one beat per second, so the .lab's seconds are beats.
  const timing: ChordTiming = {
    curve: beatMapCurve([{ startBeat: 0, times: Array.from({ length: 30 }, (_, i) => i) }], 60),
    offset: 0,
    bpm: 60,
  };
  const withChords = (extra: object = {}) => ({ ...song([], []), chords: { file: "song.chords.lab" }, ...extra });
  const labFiles = (lab: string) => (name: string) => {
    if (name === "song.chords.lab") return new TextEncoder().encode(lab);
    return files(name);
  };

  it("places the .lab's chords on the beat grid, with no score charts needed", () => {
    const out = buildChartsFile(withChords(), labFiles("0 2 A:maj\n2 4 D:maj7\n4 8 F#m7\n"), { timing });
    expect(out.charts).toEqual([]);
    expect(out.chords).toEqual([{ chord: "A", beat: 0 }, { chord: "Dmaj7", beat: 2 }, { chord: "F#m7", beat: 4 }]);
  });

  it("transposes a .lab in the recording's key to the key the band plays", () => {
    const transposed = withChords({ transpose: { from: "Db", to: "A" }, chords: { file: "song.chords.lab", key: "source" } });
    const out = buildChartsFile(transposed, labFiles("0 2 Gb:maj\n2 4 Bb:min7\n4 6 Ab:7/3\n"), { timing });
    expect(out.chords!.map((c) => c.chord)).toEqual(["D", "F#m7", "E7/G#"]);
  });

  it("leaves a .lab already in the played key alone", () => {
    const played = withChords({ transpose: { from: "Db", to: "A" }, chords: { file: "song.chords.lab", key: "played" } });
    expect(buildChartsFile(played, labFiles("0 2 D\n"), { timing }).chords!.map((c) => c.chord)).toEqual(["D"]);
  });

  it("needs the target key to spell transposed chords", () => {
    const bySteps = withChords({ transpose: -4, chords: { file: "song.chords.lab", key: "source" } });
    expect(() => buildChartsFile(bySteps, labFiles("0 2 Gb\n"), { timing })).toThrow(/transpose\.to/);
  });

  it("leaves chords out of a song with no chord file", () => {
    expect(buildChartsFile(song([fixture], [guitar]), files).chords).toBeUndefined();
  });

  it("reports .lab problems with the file and line, alongside score problems", () => {
    let message = "";
    try {
      buildChartsFile({ ...withChords(), scores: [fixture], charts: [{ ...guitar, track: 9 }] }, labFiles("0 2 A\n2 3 X\n2.5 4 D\n"), { timing });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/guitar.*track 9/);
    expect(message).toMatch(/chords \(song\.chords\.lab\): line 2: chord "X" is unknown/);
    expect(message).toMatch(/chords \(song\.chords\.lab\): line 3: starts at 2\.5, inside/);
  });

  it("needs the recording's timing to place a .lab", () => {
    expect(() => buildChartsFile(withChords(), labFiles("0 2 A\n"))).toThrow(/song\.chords\.lab.*timing/);
  });
});
