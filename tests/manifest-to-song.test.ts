import { describe, it, expect } from "vitest";
import { SongManifestSchema } from "../src/manifest.js";
import { manifestToSong, stemOffset } from "../src/manifest-to-song.js";

function mkBeats(n: number, spacing = 0.5): { time: number }[] {
  return Array.from({ length: n }, (_, i) => ({ time: i * spacing }));
}

describe("stemOffset", () => {
  it("derives the offset from the anchor (downbeat = detected beat 2 => -2)", () => {
    const beats = mkBeats(20); // 0.5s spacing => detected beat 2 at t=1.0
    expect(stemOffset({ t: 1.0, b: 0 }, beats)).toBeCloseTo(-2);
  });
  it("is 0 when the anchor is the first detected beat", () => {
    expect(stemOffset({ t: 0, b: 0 }, mkBeats(20))).toBeCloseTo(0);
  });
});

describe("manifestToSong", () => {
  const manifest = SongManifestSchema.parse({
    schema: "clickbait/song@1",
    title: "T",
    artist: "A",
    key: "Em",
    bpm: 120,
    timeSignature: [4, 4],
    preRollBars: 4,
    sources: {
      recording: { kind: "audio", file: "source.m4a", beats: { file: "b.json", "produced-by": "x" }, anchor: { t: 1.0, b: 0 } },
      stems: {
        kind: "audio-group", curveRef: "recording", "produced-by": "y", dir: "stems/",
        files: { vocals: "v.wav", drums: "d.wav" }, soffs: 0.5,
      },
    },
    songCurve: "constantBpm",
    sections: [
      { name: "Riff", b: 0, bars: 8, cue: true },
      { name: "Verse 1", b: 32, bars: 16, cue: true, lines: [{ text: "hi" }] },
    ],
    lyrics: {},
  });
  const s: any = manifestToSong(manifest, mkBeats(20), "/songs/x");

  it("carries the song header", () => {
    expect(s.title).toBe("T");
    expect(s.bpm).toBe(120);
    expect(s.artist).toBe("A");
    expect(s.timeSignature).toEqual([4, 4]);
  });

  it("maps sections to spans (name/bars/cue), keeping lyrics OUT of the tree", () => {
    const seqNode = s.children[0];
    expect(seqNode.kind).toBe("sequence");
    expect(seqNode.children.map((c: any) => c.name)).toEqual(["Riff", "Verse 1"]);
    expect(seqNode.children[0].duration).toEqual({ bars: 8 });
    expect(seqNode.children[0].cue).toBe(true);
    // lyrics are measured by build-lyrics, not carried in the Song tree
    expect(seqNode.children[1].children).toBeUndefined();
  });

  it("maps stems to audio with anchor-derived offset + beatsFile + soffs", () => {
    const audios = s.children.filter((c: any) => c.kind === "audio");
    expect(audios.map((a: any) => a.name)).toEqual(["Vocals", "Drums"]);
    expect(audios[0].offset).toBeCloseTo(-2); // anchor t=1.0 => detected beat 2 => offset -2
    expect(audios[0].beatsFile).toContain("b.json");
    expect(audios[0].file).toContain("stems/v.wav");
    expect(audios[0].soffs).toBe(0.5);
  });
});
