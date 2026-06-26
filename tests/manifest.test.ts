import { describe, it, expect } from "vitest";
import { SongManifestSchema, type SongManifest } from "../src/manifest.js";

/** A fresh, fully-valid manifest object each test can mutate in isolation. */
function validManifest(): unknown {
  return {
    schema: "clickbait/song@1",
    title: "Seven Nation Army",
    artist: "The White Stripes",
    key: "Em",
    bpm: 122.449,
    timeSignature: [4, 4],
    metadata: { file: "seven-nation-army.lookup.json", "produced-by": "clickbait-audio lookup" },
    sources: {
      recording: {
        kind: "audio",
        file: "source.m4a",
        beats: { file: "source.m4a.beats.effective.json", "produced-by": "clickbait-audio beats", edited: true },
        analysis: { file: "source.analysis.json", "produced-by": "clickbait-audio analyze" },
        anchor: { t: 0, b: 0 },
      },
      stems: {
        kind: "audio-group",
        curveRef: "recording",
        "produced-by": "clickbait-audio split --model htdemucs",
        dir: "stems/",
        files: { vocals: "source_vocals.wav", drums: "source_drums.wav", bass: "source_bass.wav", other: "source_other.wav" },
      },
    },
    songCurve: "constantBpm",
    sections: [
      { name: "Riff", b: 0, bars: 8, cue: true },
      { name: "Verse 1", b: 32, bars: 18, cue: true },
    ],
    lyrics: {
      text: { file: "seven-nation-army.lyrics.txt", "produced-by": "human" },
      alignment: { file: "source_vocals.align.json", "produced-by": "clickbait-audio align" },
      lines: [
        { b: 35, text: "I'm gonna fight 'em off", tag: "Lead Vocal" },
        { b: 42, t: 20.6, text: "A seven-nation army couldn't hold me back" },
      ],
    },
    cues: { dir: "cues/", "produced-by": "clickbait-audio speak" },
  };
}

describe("SongManifestSchema", () => {
  // -- #1 Valid minimal manifest, and z.infer is the source of truth ---------
  it("parses a fully-valid manifest", () => {
    const parsed = SongManifestSchema.parse(validManifest());
    expect(parsed.title).toBe("Seven Nation Army");
    expect(parsed.sources.recording.beats.edited).toBe(true);
    // Type-level check: the inferred type flows (compile-time, but assert shape).
    const m: SongManifest = parsed;
    expect(m.bpm).toBeCloseTo(122.449);
  });

  it("accepts a minimal manifest (only required fields)", () => {
    const minimal = {
      schema: "clickbait/song@1",
      title: "Untitled",
      bpm: 120,
      timeSignature: [4, 4],
      sources: {
        recording: {
          kind: "audio",
          file: "source.m4a",
          beats: { file: "source.m4a.beats.json", "produced-by": "clickbait-audio beats" },
          anchor: { t: 0, b: 0 },
        },
      },
      songCurve: "constantBpm",
      sections: [{ name: "Verse 1", b: 0, bars: 8 }],
      lyrics: {
        text: { file: "x.lyrics.txt", "produced-by": "human" },
        lines: [{ b: 0, text: "hello" }],
      },
    };
    expect(() => SongManifestSchema.parse(minimal)).not.toThrow();
  });

  // -- #2 Required fields enforced -------------------------------------------
  it("rejects a missing schema tag", () => {
    const m = validManifest() as any;
    delete m.schema;
    expect(() => SongManifestSchema.parse(m)).toThrow();
  });

  it("rejects a wrong schema tag", () => {
    const m = validManifest() as any;
    m.schema = "clickbait/song@99";
    expect(() => SongManifestSchema.parse(m)).toThrow();
  });

  it("rejects a missing title / bpm / recording", () => {
    for (const mut of [
      (m: any) => delete m.title,
      (m: any) => delete m.bpm,
      (m: any) => delete m.sources.recording,
    ]) {
      const m = validManifest() as any;
      mut(m);
      expect(() => SongManifestSchema.parse(m)).toThrow();
    }
  });

  it("rejects a non-positive bpm", () => {
    const m = validManifest() as any;
    m.bpm = 0;
    expect(() => SongManifestSchema.parse(m)).toThrow();
  });

  // -- #3 Lyric coordinate flexibility (b, t, or both) -----------------------
  it("accepts lyric lines with b only, t only, or both", () => {
    for (const line of [
      { b: 10, text: "beat only" },
      { t: 5.5, text: "time only" },
      { b: 10, t: 5.5, text: "both" },
    ]) {
      const m = validManifest() as any;
      m.lyrics.lines = [line];
      expect(() => SongManifestSchema.parse(m), JSON.stringify(line)).not.toThrow();
    }
  });

  it("accepts a text-only lyric line (timing resolved from alignment at build)", () => {
    // A source line is a display unit; timing comes from align, not the author.
    const m = validManifest() as any;
    m.lyrics.lines = [{ text: "no authored coordinate" }];
    expect(() => SongManifestSchema.parse(m)).not.toThrow();
  });

  // -- #4 Cross-refs: curveRef must name an existing source ------------------
  it("rejects a stems.curveRef that names no source", () => {
    const m = validManifest() as any;
    m.sources.stems.curveRef = "nonexistent";
    expect(() => SongManifestSchema.parse(m)).toThrow(/curveRef/i);
  });

  it("accepts a valid curveRef", () => {
    const m = validManifest() as any;
    m.sources.stems.curveRef = "recording";
    expect(() => SongManifestSchema.parse(m)).not.toThrow();
  });

  // -- #5 songCurve kinds ----------------------------------------------------
  it("rejects an unknown songCurve kind", () => {
    const m = validManifest() as any;
    m.songCurve = "magicSpline";
    expect(() => SongManifestSchema.parse(m)).toThrow();
  });

  // -- #6 Artifact provenance ------------------------------------------------
  it("requires produced-by on referenced artifacts", () => {
    const m = validManifest() as any;
    delete m.sources.recording.beats["produced-by"];
    expect(() => SongManifestSchema.parse(m)).toThrow();
  });

  // -- #7 timeSignature shape ------------------------------------------------
  it("rejects a malformed timeSignature", () => {
    for (const ts of [[4], [4, 4, 4], [0, 4], [4, 0], [3.5, 4], ["4", "4"]]) {
      const m = validManifest() as any;
      m.timeSignature = ts;
      expect(() => SongManifestSchema.parse(m), JSON.stringify(ts)).toThrow();
    }
  });

  it("accepts a valid odd-meter timeSignature", () => {
    const m = validManifest() as any;
    m.timeSignature = [7, 8];
    expect(() => SongManifestSchema.parse(m)).not.toThrow();
  });
});
