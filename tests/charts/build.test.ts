import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildChartsFile } from "../../src/charts/build.js";
import type { ChartSpec } from "../../src/manifest.js";

// The 4-bar fixture score: Intro (bars 1–2) and Verse (bars 3–4) markers,
// tracks Guitar, Bass, Drums.
const FIXTURE = readFileSync(resolve(import.meta.dirname, "../fixtures/charts/three-tracks.atex"));

const song = (charts: ChartSpec[]) => ({
  title: "Fixture",
  artist: "Test",
  timeSignature: [4, 4] as [number, number],
  sections: [{ name: "Intro", bars: 2 }, { name: "Verse", bars: 2 }, { name: "Verse", bars: 2 }],
  charts,
});
const guitar: ChartSpec = {
  id: "guitar",
  kind: "tab",
  instrument: "guitar",
  source: "fixture.atex",
  track: 0,
  sections: [{ section: "Intro", bars: [1, 2] }, { section: "Verse", bars: [3, 4] }],
};
const files = (name: string) => {
  if (name === "fixture.atex") return new Uint8Array(FIXTURE);
  throw new Error(`ENOENT: ${name}`);
};

describe("buildChartsFile", () => {
  it("maps each chart's bars and records the song's sections", () => {
    const out = buildChartsFile(song([guitar]), files);
    expect(out.schema).toBe("clickbait/charts@1");
    expect(out.slug).toBe("fixture-test");
    expect(out.sections.map((s) => [s.name, s.occurrence, s.startBeat])).toEqual([["Intro", 1, 0], ["Verse", 1, 8], ["Verse", 2, 16]]);
    const [c] = out.charts;
    expect(c).toMatchObject({ id: "guitar", kind: "tab", instrument: "guitar", source: "fixture.atex", track: 0, trackName: "Guitar" });
    expect(c.bars.map((b) => b.scoreBar)).toEqual([1, 2, 3, 4, 3, 4]);
  });

  it("names a score file it can't find", () => {
    expect(() => buildChartsFile(song([{ ...guitar, source: "missing.gp5" }]), files)).toThrow(/missing\.gp5/);
  });

  it("reports every problem at once, not just the first", () => {
    const badTrack = { ...guitar, id: "bad-track", track: 9 };
    const pastEnd = { ...guitar, id: "past-end", sections: [{ section: "Intro", bars: [7, 8] as [number, number] }] };
    let message = "";
    try {
      buildChartsFile(song([badTrack, pastEnd]), files);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/bad-track.*track 9/);
    expect(message).toMatch(/past-end.*score ends at bar 4/);
  });

  it("reads each score file once, however many charts use it", () => {
    let reads = 0;
    const counting = (name: string) => {
      reads++;
      return files(name);
    };
    buildChartsFile(song([guitar, { ...guitar, id: "bass", instrument: "bass", track: 1 }]), counting);
    expect(reads).toBe(1);
  });
});
