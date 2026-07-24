import { describe, it, expect } from "vitest";
import { SongManifestSchema } from "../src/manifest.js";
import { manifestToSong, stemOffset } from "../src/build/manifest-to-song.js";

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
        kind: "audio-group", curveRef: "recording", dir: "stems/",
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

describe("manifestToSong clips", () => {
  // beat-map is identity-ish: beat i at 0.5i s (bpm 120), so toBeat(t) = 2t.
  const base = {
    schema: "clickbait/song@1" as const, title: "T", bpm: 120, timeSignature: [4, 4] as [number, number],
    songCurve: "constantBpm" as const, lyrics: {},
  };
  const recording = { kind: "audio" as const, file: "s.m4a", beatMap: [{ startBeat: 0, times: mkTimes(40, 0.5) }] };

  it("expands a repeat into per-clip items sharing one track", () => {
    const m = SongManifestSchema.parse({
      ...base,
      sources: {
        recording,
        stems: { kind: "audio-group", curveRef: "recording", dir: "stems/",
          files: { vocals: "v.wav", drums: "d.wav" },
          // clip 1: 8s of source (=16 beats) from 0; clip 2: repeat first 4s (=8 beats) from 0.
          clips: [{ from: 0, seconds: 8 }, { from: 0, seconds: 4 }] },
      },
      // sections must tile the clips' 24 beats (= 6 bars).
      sections: [{ name: "Verse", bars: 4 }, { name: "Outro", bars: 2 }],
    });
    const s: any = manifestToSong(m, "/x");
    const audios = s.children.filter((c: any) => c.kind === "audio");
    // 2 clips x 2 stems = 4 nodes; same names => grouped into 2 tracks downstream.
    expect(audios.map((a: any) => a.name)).toEqual(["Vocals", "Drums", "Vocals", "Drums"]);
    // clip 1 at timeline beat 0, source [0, 8]
    expect(audios[0]).toMatchObject({ name: "Vocals", offset: 0, soffs: 0, sourceEnd: 8 });
    // clip 2 placed after clip 1 (16 beats), source [0, 4] — the repeat
    expect(audios[2]).toMatchObject({ name: "Vocals", offset: 16, soffs: 0, sourceEnd: 4 });
  });

  it("advances the timeline cursor across a silence clip without emitting audio", () => {
    const m = SongManifestSchema.parse({
      ...base,
      sources: {
        recording,
        stems: { kind: "audio-group", curveRef: "recording", dir: "stems/",
          files: { vocals: "v.wav" },
          clips: [{ from: 0, seconds: 8 }, { silence: 2 }, { from: 0, seconds: 4 }] },
      },
      // 16 (clip1) + 4 (silence: 2s @120bpm) + 8 (clip2) = 28 beats = 7 bars.
      sections: [{ name: "A", bars: 7 }],
    });
    const s: any = manifestToSong(m, "/x");
    const audios = s.children.filter((c: any) => c.kind === "audio");
    expect(audios.length).toBe(2); // silence emits no audio node
    expect(audios[1]).toMatchObject({ offset: 20, soffs: 0, sourceEnd: 4 }); // 16 + 4 silence
  });

  it("throws when clips don't tile the section timeline", () => {
    const m = SongManifestSchema.parse({
      ...base,
      sources: {
        recording,
        stems: { kind: "audio-group", curveRef: "recording", dir: "stems/",
          files: { vocals: "v.wav" }, clips: [{ from: 0, seconds: 8 }, { from: 0, seconds: 4 }] },
      },
      sections: [{ name: "A", bars: 4 }], // 16 beats, but clips span 24
    });
    expect(() => manifestToSong(m, "/x")).toThrow(/clips span/);
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
