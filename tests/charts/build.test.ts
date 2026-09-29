import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildChartsFile } from "../../src/charts/build.js";
import type { ChartSpec, ScoreSpec } from "../../src/manifest.js";

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

  it("skips a score no chart uses", () => {
    const unused: ScoreSpec = { ...fixture, id: "unused", file: "missing.gp5" };
    expect(() => buildChartsFile(song([fixture, unused], [guitar]), files)).not.toThrow();
  });
});
