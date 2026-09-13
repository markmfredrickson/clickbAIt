import { describe, it, expect } from "vitest";
import { assembleSong } from "../src/build/assemble.js";
import { extractSections } from "../src/build/sections.js";
import type { SongManifest } from "../src/manifest.js";
import type { Audio, Song } from "../src/core/dsongl/index.js";

/**
 * Frame: 60 BPM in 4/4, and a beat-map whose source-second == song-beat. Every
 * expected soffs/sourceEnd is then hand-computable — a section at beat 4 for 8
 * beats is source seconds 4..12.
 */
const manifest = (over: Partial<SongManifest> = {}): SongManifest =>
  ({
    title: "Test Song",
    artist: "Tester",
    bpm: 60,
    timeSignature: [4, 4],
    sources: {
      recording: {
        kind: "audio",
        file: "source.m4a",
        beatMap: [{ startBeat: 0, times: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] }],
      },
      stems: {
        kind: "audio-group",
        curveRef: "recording",
        dir: "stems",
        files: { drums: "d.wav", vocals: "v.wav" },
      },
    },
    sections: [
      { name: "Intro", bars: 1 },
      { name: "Chorus", bars: 2, cue: true },
      { name: "Outro", bars: 1 },
    ],
    ...over,
  }) as SongManifest;

const src = (m: SongManifest = manifest(), dir = "/songs/test") => ({ manifest: m, dir });

/** Every audio node on the assembled song, in emission order. */
const audios = (s: Song): Audio[] => s.children.filter((c): c is Audio => c.kind === "audio");

describe("assembleSong", () => {
  it("lifts a section as a span carrying the source song's tempo and duration", () => {
    const out = assembleSong("Check", [{ source: src(), section: "Chorus" }]);
    const secs = extractSections(out);
    expect(secs.map((s) => s.name)).toEqual(["Test Song · Chorus"]);
    expect(secs[0].beat).toBe(0);
    expect(secs[0].durationBeats).toBe(8);
    expect(secs[0].bpm).toBe(60);
  });

  it("crops each stem to the section's source-second range", () => {
    const out = assembleSong("Check", [{ source: src(), section: "Chorus" }]);
    const a = audios(out);
    expect(a.map((x) => x.name)).toEqual(["Drums", "Vocals"]);
    // Chorus = beats 4..12 → source seconds 4..12 in this frame.
    for (const node of a) {
      expect(node.soffs).toBeCloseTo(4, 6);
      expect(node.sourceEnd).toBeCloseTo(12, 6);
      expect(node.offset).toBe(0);
    }
  });

  it("places pieces end-to-end, and opens a gap when asked", () => {
    const out = assembleSong("Check", [
      { source: src(), section: "Chorus", gapBars: 1 },
      { source: src(), section: "Intro" },
    ]);
    const secs = extractSections(out);
    expect(secs.map((s) => s.name)).toEqual(["Test Song · Chorus", "Test Song · Intro"]);
    expect(secs[0].beat).toBe(0);
    // 8 beats of chorus + 4 beats of gap.
    expect(secs[1].beat).toBe(12);
    expect(audios(out).filter((x) => x.offset === 12)).toHaveLength(2);
  });

  it("carries a section's cue flag through unchanged", () => {
    const out = assembleSong("Check", [
      { source: src(), section: "Chorus" },
      { source: src(), section: "Outro" },
    ]);
    const secs = extractSections(out);
    expect(secs[0].cue).toBe(true);   // Chorus is cue: true in the source
    expect(secs[1].cue).toBeUndefined();
  });

  it("resolves two picks from the same song independently", () => {
    const out = assembleSong("Check", [
      { source: src(), section: "Outro" },
      { source: src(), section: "Intro" },
    ]);
    const a = audios(out);
    // Outro = beats 12..16, Intro = beats 0..4.
    expect(a.slice(0, 2).map((x) => [x.soffs, x.sourceEnd])).toEqual([[12, 16], [12, 16]]);
    expect(a.slice(2).map((x) => [x.soffs, x.sourceEnd])).toEqual([[0, 4], [0, 4]]);
  });

  it("throws when a pick names a section the source song doesn't have", () => {
    expect(() => assembleSong("Check", [{ source: src(), section: "Bridge" }])).toThrow(/Bridge/);
  });

  it("takes the whole song when a pick omits the section", () => {
    const out = assembleSong("Set", [{ source: src() }]);
    const secs = extractSections(out);
    expect(secs.map((s) => s.name)).toEqual([
      "Test Song · Intro",
      "Test Song · Chorus",
      "Test Song · Outro",
    ]);
    // One item per stem, lifted untouched — a whole-song pick imposes no crop,
    // so the piece plays exactly what the source project plays.
    const a = audios(out);
    expect(a).toHaveLength(2);
    expect(a.map((x) => [x.soffs, x.sourceEnd])).toEqual([[undefined, undefined], [undefined, undefined]]);
    expect(a.map((x) => x.offset)).toEqual([0, 0]);
  });

  it("moves a whole-song pick to its place on the timeline", () => {
    const out = assembleSong("Set", [
      { source: src(), section: "Chorus", gapBars: 2 },
      { source: src() },
    ]);
    // 8 beats of chorus + 8 beats of gap → the second song starts at beat 16.
    expect(audios(out).slice(2).map((x) => x.offset)).toEqual([16, 16]);
  });

  it("points each stem at its own song's beats sidecar, so pieces don't share a grid", () => {
    const out = assembleSong("Check", [
      { source: { ...src(), beatsFile: "/songs/test/source.m4a.beats.json" }, section: "Chorus" },
    ]);
    for (const node of audios(out)) {
      expect(node.beatsFile).toBe("/songs/test/source.m4a.beats.json");
    }
  });

  it("takes the project tempo and meter from the first piece", () => {
    const waltz = manifest({ bpm: 90, timeSignature: [3, 4], title: "Waltz" });
    const out = assembleSong("Check", [
      { source: src(waltz), section: "Chorus" },
      { source: src(), section: "Chorus" },
    ]);
    expect(out.bpm).toBe(90);
    expect(out.timeSignature).toEqual([3, 4]);
  });
});

describe("assembleSong beat-map resolution", () => {
  it("resolves a beat-map that points at an external sidecar", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dir = mkdtempSync(join(tmpdir(), "cb-assemble-"));
    writeFileSync(
      join(dir, "source.m4a.beatmap.json"),
      JSON.stringify([{ startBeat: 0, times: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] }]),
    );

    const m = manifest();
    m.sources.recording.beatMap = { file: "source.m4a.beatmap.json" };

    const out = assembleSong("Check", [{ source: { manifest: m, dir }, section: "Chorus" }]);
    for (const node of audios(out)) {
      expect(node.soffs).toBeCloseTo(4, 6);
      expect(node.sourceEnd).toBeCloseTo(12, 6);
    }
  });
});

describe("assembleSong stem selection", () => {
  it("takes only the named stems — a show file plays the horn part, not the reference split", () => {
    const out = assembleSong("Set", [{ source: src(), section: "Chorus", stems: ["vocals"] }]);
    const a = audios(out);
    expect(a.map((x) => x.name)).toEqual(["Vocals"]);
    expect(a[0].soffs).toBeCloseTo(4, 6);
  });

  it("takes every stem when none are named", () => {
    const out = assembleSong("Set", [{ source: src(), section: "Chorus" }]);
    expect(audios(out).map((x) => x.name)).toEqual(["Drums", "Vocals"]);
  });

  it("throws when a pick names a stem the song doesn't have", () => {
    expect(() =>
      assembleSong("Set", [{ source: src(), section: "Chorus", stems: ["horns"] }]),
    ).toThrow(/horns/);
  });
});
