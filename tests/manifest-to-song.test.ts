import { describe, it, expect } from "vitest";
import { SongManifestSchema } from "../src/manifest.js";
import { manifestToSong, stemOffset } from "../src/manifest-to-song.js";

function mkTimes(n: number, spacing = 0.5): number[] {
  return Array.from({ length: n }, (_, i) => i * spacing);
}

describe("stemOffset", () => {
  it("derives the offset from the anchor (downbeat = detected beat 2 => -2)", () => {
    const beats = Array.from({ length: 20 }, (_, i) => ({ time: i * 0.5 }));
    expect(stemOffset({ t: 1.0, b: 0 }, beats)).toBeCloseTo(-2);
  });
  it("is 0 when the anchor is the first detected beat", () => {
    const beats = Array.from({ length: 20 }, (_, i) => ({ time: i * 0.5 }));
    expect(stemOffset({ t: 0, b: 0 }, beats)).toBeCloseTo(0);
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
      // beat-map: detected beats start at song beat -2 (i.e. the downbeat is
      // detected beat 2 — the old anchor t=1.0 case), so the stem offset is -2.
      recording: { kind: "audio", file: "source.m4a", beatMap: [{ startBeat: -2, times: mkTimes(20) }] },
      stems: {
        kind: "audio-group", curveRef: "recording", "produced-by": "y", dir: "stems/",
        files: { vocals: "v.wav", drums: "d.wav" }, soffs: 0.5,
      },
    },
    songCurve: "constantBpm",
    sections: [
      { name: "Riff", bars: 8, cue: true },
      { name: "Verse 1", bars: 16, cue: true, lines: [{ text: "hi" }] },
    ],
    lyrics: {},
  });
  const s: any = manifestToSong(manifest, "/songs/x");

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

  it("maps stems to audio with beat-map-derived offset + soffs (beats fed separately)", () => {
    const audios = s.children.filter((c: any) => c.kind === "audio");
    expect(audios.map((a: any) => a.name)).toEqual(["Vocals", "Drums"]);
    expect(audios[0].offset).toBeCloseTo(-2); // first control point is song beat -2
    expect(audios[0].file).toContain("stems/v.wav");
    expect(audios[0].soffs).toBe(0.5);
    // The per-beat source times are passed to build-rpp as `recordingBeats`,
    // not carried on the node, so there is no `beatsFile` anymore.
    expect(audios[0].beatsFile).toBeUndefined();
  });
});

describe("manifestToSong cue marks", () => {
  it("maps section.cues to cue() events at section-relative beats", () => {
    const m = SongManifestSchema.parse({
      schema: "clickbait/song@1", title: "T", bpm: 120, timeSignature: [4, 4],
      sources: { recording: { kind: "audio", file: "s.m4a", beatMap: [{ startBeat: 0, times: mkTimes(4) }] } },
      songCurve: "constantBpm",
      sections: [{ name: "Hit", bars: 1, cue: true, cues: [{ at: 0, label: "one" }] }],
      lyrics: {},
    });
    const song: any = manifestToSong(m, "/x");
    const hit = song.children[0].children[0];
    expect(hit.name).toBe("Hit");
    expect(hit.children[0]).toMatchObject({ type: "cue", value: "one", offset: 0 });
  });
});
