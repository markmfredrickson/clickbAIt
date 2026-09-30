import { describe, it, expect } from "vitest";
import { SongManifestSchema, sectionStarts, type SongManifest } from "../src/manifest.js";

/** A fresh, fully-valid manifest object each test can mutate in isolation. */
function validManifest(): unknown {
  return {
    schema: "clickbait/song@1",
    title: "Seven Nation Army",
    artist: "The White Stripes",
    key: "Em",
    bpm: 122.449,
    timeSignature: [4, 4],
    metadata: { file: "seven-nation-army.lookup.json" },
    sources: {
      recording: {
        kind: "audio",
        file: "source.m4a",
        analysis: { file: "source.analysis.json" },
        beatMap: [{ startBeat: 0, times: [0, 0.49, 0.98] }],
      },
      stems: {
        kind: "audio-group",
        curveRef: "recording",
        dir: "stems/",
        files: { vocals: "source_vocals.wav", drums: "source_drums.wav", bass: "source_bass.wav", other: "source_other.wav" },
      },
    },
    songCurve: "constantBpm",
    sections: [
      { name: "Riff", bars: 8, cue: true },
      { name: "Verse 1", bars: 18, cue: true, lines: [
        { text: "I'm gonna fight 'em off", tag: "Lead Vocal" },
        { text: "A seven-nation army couldn't hold me back" },
      ] },
    ],
    lyrics: {
      alignment: { file: "source_vocals.align.json" },
    },
    cues: { dir: "cues/" },
  };
}

describe("SongManifestSchema", () => {
  // -- #1 Valid minimal manifest, and z.infer is the source of truth ---------
  it("parses a fully-valid manifest", () => {
    const parsed = SongManifestSchema.parse(validManifest());
    expect(parsed.title).toBe("Seven Nation Army");
    expect(parsed.sources.recording.beatMap).toHaveLength(1);
    // Type-level check: the inferred type flows (compile-time, but assert shape).
    const m: SongManifest = parsed;
    expect(m.bpm).toBeCloseTo(122.449);
  });

  it("accepts a pitch (tone) cue and rejects a cue with neither label nor tone", () => {
    const withTone = validManifest() as { sections: { cues?: unknown }[] };
    withTone.sections[0].cues = [{ at: -4, tone: ["F#3", "A#3", "C#4"], bars: 1 }];
    expect(() => SongManifestSchema.parse(withTone)).not.toThrow();

    const spoken = validManifest() as { sections: { cues?: unknown }[] };
    spoken.sections[0].cues = [{ at: -4, label: "F sharp" }];
    expect(() => SongManifestSchema.parse(spoken)).not.toThrow();

    const empty = validManifest() as { sections: { cues?: unknown }[] };
    empty.sections[0].cues = [{ at: -4 }]; // neither label nor tone
    expect(() => SongManifestSchema.parse(empty)).toThrow();
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
          beatMap: [{ startBeat: 0, times: [0, 0.5, 1.0] }],
        },
      },
      songCurve: "constantBpm",
      sections: [{ name: "Verse 1", bars: 8, lines: [{ text: "hello" }] }],
      lyrics: {},
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
      m.sections[1].lines = [line]; // Verse 1
      expect(() => SongManifestSchema.parse(m), JSON.stringify(line)).not.toThrow();
    }
  });

  it("accepts a text-only lyric line (timing resolved from alignment at build)", () => {
    // A source line is a display unit; timing comes from align, not the author.
    const m = validManifest() as any;
    m.sections[1].lines = [{ text: "no authored coordinate" }];
    expect(() => SongManifestSchema.parse(m)).not.toThrow();
  });

  // -- #4 Cross-refs: curveRef must name an existing source ------------------
  it("rejects a stems.curveRef that names no source", () => {
    const m = validManifest() as any;
    m.sources.stems.curveRef = "nonexistent";
    expect(() => SongManifestSchema.parse(m)).toThrow(/curveRef/i);
  });

  // -- Practice bundle variants: `bundle.variants` names stems to mute --------
  it("accepts a bundle.variants block whose mute keys name stems", () => {
    const m = validManifest() as any;
    m.bundle = { variants: [{ id: "minus-rhythm", label: "No drums or bass", mute: ["drums", "bass"] }] };
    const parsed = SongManifestSchema.parse(m);
    expect(parsed.bundle?.variants?.[0].mute).toEqual(["drums", "bass"]);
  });

  it("rejects a bundle variant that mutes a key no stem has", () => {
    const m = validManifest() as any;
    m.bundle = { variants: [{ id: "x", mute: ["keys"] }] };
    expect(() => SongManifestSchema.parse(m)).toThrow(/keys/);
  });

  it("rejects a bundle block with unknown fields", () => {
    const m = validManifest() as any;
    m.bundle = { variants: [], bitrate: 96 };
    expect(() => SongManifestSchema.parse(m)).toThrow();
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

  // -- #6 Artifact refs are file-only -----------------------------------------
  // Provenance lives in the song's package.json recipe, never restated here.
  it("rejects a stray produced-by on an artifact ref", () => {
    const m = validManifest() as any;
    m.sources.recording.analysis["produced-by"] = "clickbait-audio analyze";
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

  // -- pre-roll --------------------------------------------------------------
  it("defaults preRollBars to 0 and accepts a whole-bar count", () => {
    expect((SongManifestSchema.parse(validManifest()) as any).preRollBars).toBe(0);
    const m = validManifest() as any;
    m.preRollBars = 4;
    expect((SongManifestSchema.parse(m) as any).preRollBars).toBe(4);
  });

  it("rejects negative or fractional preRollBars", () => {
    for (const v of [-1, 1.5]) {
      const m = validManifest() as any;
      m.preRollBars = v;
      expect(() => SongManifestSchema.parse(m), String(v)).toThrow();
    }
  });

  // -- sections carry no absolute start beat --------------------------------
  it("rejects a section with an authored start beat `b`", () => {
    // Start beats are inferred from order + length, not authored — a redundant
    // `b` that could disagree with the running total is a schema error.
    const m = validManifest() as any;
    m.sections[0].b = 0;
    expect(() => SongManifestSchema.parse(m)).toThrow(/unrecognized|b/i);
  });
});

describe("sectionStarts", () => {
  it("returns each section's start plus a one-past-end song-end beat", () => {
    // Sections run back-to-back from beat 0: 8 bars, then 18 bars, in 4/4.
    const starts = sectionStarts(
      [{ bars: 8 }, { bars: 18 }],
      [4, 4],
    );
    expect(starts).toEqual([0, 32, 32 + 18 * 4]);
  });

  it("honors a per-section meter override in the running total", () => {
    // A 2/4 pickup bar contributes 2 beats, not the song-default 4.
    const starts = sectionStarts(
      [{ bars: 1, timeSignature: [2, 4] }, { bars: 4 }],
      [4, 4],
    );
    expect(starts).toEqual([0, 2, 2 + 16]);
  });

  it("returns [0] (just the song end at 0) for no sections", () => {
    expect(sectionStarts([], [4, 4])).toEqual([0]);
  });
});

// -- Chart channels: `scores` maps a score's bars onto our sections, and each
// -- entry in `charts` is one track of a score ------------------------------
describe("SongManifestSchema — scores and charts", () => {
  /** validManifest() with three Riff/Verse pairs, as in Seven Nation Army. */
  function withScore(links: unknown[], charts: unknown[] = [chart()], scoreExtra: object = {}): any {
    const m = validManifest() as any;
    m.sections = [
      { name: "Riff", bars: 8 },
      { name: "Verse", bars: 18 },
      { name: "Riff", bars: 8 },
      { name: "Verse", bars: 18 },
      { name: "Riff", bars: 8 },
      { name: "Verse", bars: 16 },
    ];
    m.scores = [{ id: "ug", file: "song.gp5", sections: links, ...scoreExtra }];
    m.charts = charts;
    return m;
  }
  function chart(extra: object = {}) {
    return { id: "rhythm-guitar", kind: "tab", instrument: "guitar", score: "ug", track: 2, ...extra };
  }

  it("accepts a score whose links map sections to its bars, and charts that pick its tracks", () => {
    const m = withScore(
      [
        { section: "Riff", bars: [1, 8] },
        { section: "Verse", occurrence: 1, bars: [9, 26] },
        { section: "Verse", occurrence: 2, bars: [45, 62] },
        { section: "Verse", occurrence: 3, bars: [89, 104] },
      ],
      [chart(), chart({ id: "bass", instrument: "bass", track: 3 })],
    );
    const parsed = SongManifestSchema.parse(m);
    expect(parsed.scores?.[0].sections).toHaveLength(4);
    expect(parsed.charts?.map((c) => c.track)).toEqual([2, 3]);
  });

  it("lets every occurrence of a section share one score range", () => {
    expect(() => SongManifestSchema.parse(withScore([{ section: "Riff", bars: [1, 8] }]))).not.toThrow();
  });

  it("rejects a section name the song doesn't have", () => {
    expect(() => SongManifestSchema.parse(withScore([{ section: "Chorus", bars: [1, 8] }]))).toThrow(/Chorus/);
  });

  it("rejects an occurrence past the last one", () => {
    const m = withScore([{ section: "Verse", occurrence: 4, bars: [1, 18] }]);
    expect(() => SongManifestSchema.parse(m)).toThrow(/Verse.*4/);
  });

  it("rejects a range whose length differs from the section, naming both lengths", () => {
    expect(() => SongManifestSchema.parse(withScore([{ section: "Riff", bars: [1, 4] }]))).toThrow(/Riff.*8 bars.*4/s);
  });

  it("rejects a mismatch even when the range divides the section evenly", () => {
    // Repeating is the human's call, stated with `repeat`, never inferred.
    expect(() => SongManifestSchema.parse(withScore([{ section: "Riff", bars: [1, 2] }]))).toThrow(/repeat/);
  });

  it("accepts an explicit repeat that fills the section, and rejects one that doesn't", () => {
    expect(() => SongManifestSchema.parse(withScore([{ section: "Riff", bars: [1, 2], repeat: 4 }]))).not.toThrow();
    expect(() => SongManifestSchema.parse(withScore([{ section: "Riff", bars: [1, 2], repeat: 3 }]))).toThrow(/Riff/);
  });

  it("checks a name-wide link against every occurrence's length", () => {
    // The third Verse is 16 bars, so one 18-bar range can't serve all three.
    expect(() => SongManifestSchema.parse(withScore([{ section: "Verse", bars: [9, 26] }]))).toThrow(/Verse.*3/);
  });

  it("lets a per-occurrence link override a name-wide one", () => {
    const m = withScore([
      { section: "Verse", bars: [9, 26] },
      { section: "Verse", occurrence: 3, bars: [89, 104] },
    ]);
    expect(() => SongManifestSchema.parse(m)).not.toThrow();
  });

  it("rejects two links for the same section occurrence", () => {
    const twiceByName = withScore([
      { section: "Riff", bars: [1, 8] },
      { section: "Riff", bars: [37, 44] },
    ]);
    expect(() => SongManifestSchema.parse(twiceByName)).toThrow(/Riff/);
    const twiceByOccurrence = withScore([
      { section: "Riff", occurrence: 2, bars: [1, 8] },
      { section: "Riff", occurrence: 2, bars: [37, 44] },
    ]);
    expect(() => SongManifestSchema.parse(twiceByOccurrence)).toThrow(/Riff/);
  });

  it("rejects a reversed bar range", () => {
    expect(() => SongManifestSchema.parse(withScore([{ section: "Riff", bars: [8, 1] }]))).toThrow();
  });

  it("rejects a chart that names a score the manifest doesn't have", () => {
    const m = withScore([], [chart({ score: "songsterr" })]);
    expect(() => SongManifestSchema.parse(m)).toThrow(/songsterr/);
  });

  it("rejects duplicate score ids", () => {
    const m = withScore([]);
    m.scores.push({ id: "ug", file: "other.gp5", sections: [] });
    expect(() => SongManifestSchema.parse(m)).toThrow(/ug/);
  });

  it("rejects duplicate chart ids and ids that clash with built-in channels", () => {
    expect(() => SongManifestSchema.parse(withScore([], [chart(), chart()]))).toThrow(/rhythm-guitar/);
    expect(() => SongManifestSchema.parse(withScore([], [chart({ id: "lyrics" })]))).toThrow(/lyrics/);
  });
});

describe("SongManifestSchema — chords", () => {
  it("accepts a chord file", () => {
    const m = validManifest() as any;
    m.chords = { file: "song.chords.lab" };
    expect(SongManifestSchema.parse(m).chords).toEqual({ file: "song.chords.lab" });
  });

  it("accepts the key a transposed song's chord file is in", () => {
    for (const key of ["source", "played"]) {
      const m = validManifest() as any;
      m.transpose = { from: "Db", to: "A" };
      m.chords = { file: "song.chords.lab", key };
      expect(SongManifestSchema.parse(m).chords?.key).toBe(key);
    }
  });

  it("requires the key when the song is transposed", () => {
    const m = validManifest() as any;
    m.transpose = { from: "Db", to: "A" };
    m.chords = { file: "song.chords.lab" };
    expect(() => SongManifestSchema.parse(m)).toThrow(/chords\.key/);
  });

  it("rejects any other key", () => {
    const m = validManifest() as any;
    m.chords = { file: "song.chords.lab", key: "A" };
    expect(() => SongManifestSchema.parse(m)).toThrow();
  });

  it("keeps the chords channel name away from charts", () => {
    const m = validManifest() as any;
    m.scores = [{ id: "ug", file: "song.gp5", sections: [] }];
    m.charts = [{ id: "chords", kind: "tab", instrument: "guitar", score: "ug", track: 0 }];
    expect(() => SongManifestSchema.parse(m)).toThrow(/chords.*is a built-in channel name/);
  });
});
