import { describe, it, expect } from "vitest";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  keyToSemitones,
  transposeNote,
  stemPlayback,
  SHIFTER_MODES,
} from "../src/build/transpose.js";
import { SongManifestSchema } from "../src/manifest.js";
import { manifestToSong } from "../src/build/manifest-to-song.js";
import { buildRpp } from "../src/build/rpp.js";
import { song, seq, span, bars, audio } from "@clickbait/dsongl";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, "fixtures");

// ---------------------------------------------------------------------------
// keyToSemitones: key pair → steps, shortest distance, ties resolve DOWN.
// ---------------------------------------------------------------------------

describe("keyToSemitones", () => {
  it("G→D is -5 (down a fourth), not +7", () => {
    expect(keyToSemitones("G", "D")).toBe(-5);
  });

  it("D→G is +5", () => {
    expect(keyToSemitones("D", "G")).toBe(5);
  });

  it("takes the shortest distance in both directions", () => {
    expect(keyToSemitones("A", "C")).toBe(3);
    expect(keyToSemitones("C", "A")).toBe(-3);
  });

  it("resolves the tritone tie downward", () => {
    expect(keyToSemitones("G", "C#")).toBe(-6);
    expect(keyToSemitones("G", "Db")).toBe(-6);
  });

  it("treats enharmonic spellings as equal", () => {
    expect(keyToSemitones("F#", "Gb")).toBe(0);
  });

  it("is case-insensitive", () => {
    expect(keyToSemitones("g", "d")).toBe(-5);
  });

  it("ignores mode suffixes (lookup keys arrive as 'G major', 'Em', …)", () => {
    expect(keyToSemitones("G major", "D major")).toBe(-5);
    expect(keyToSemitones("Em", "Am")).toBe(5);
    expect(keyToSemitones("B minor", "A minor")).toBe(-2);
  });

  it("handles flats", () => {
    expect(keyToSemitones("Bb", "F")).toBe(-5);
  });

  it("throws on an unparseable key", () => {
    expect(() => keyToSemitones("H", "D")).toThrow();
    expect(() => keyToSemitones("", "D")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// transposeNote: prep-tone notes move with the song.
// ---------------------------------------------------------------------------

describe("transposeNote", () => {
  it("shifts within an octave", () => {
    expect(transposeNote("F#3", -5)).toBe("C#3");
    expect(transposeNote("A4", -5)).toBe("E4");
  });

  it("crosses octave boundaries", () => {
    expect(transposeNote("C4", -1)).toBe("B3");
    expect(transposeNote("B3", 1)).toBe("C4");
  });

  it("prefers sharps for black keys", () => {
    expect(transposeNote("A4", 1)).toBe("A#4");
  });

  it("normalizes flat input", () => {
    expect(transposeNote("Bb3", 2)).toBe("C4");
  });

  it("is identity at 0 steps", () => {
    expect(transposeNote("F#3", 0)).toBe("F#3");
  });
});

// ---------------------------------------------------------------------------
// stemPlayback: per-stem pitch + shifter mode from a transpose spec.
// Defaults: vocal-ish stems → élastique Soloist Monophonic; drums → unshifted;
// everything else pitched → élastique Pro Normal. All overridable.
// ---------------------------------------------------------------------------

describe("stemPlayback", () => {
  it("no transpose → pitch 0, project-default shifter (today's output)", () => {
    expect(stemPlayback("vocals", undefined)).toEqual({ pitch: 0, mode: -1 });
    expect(stemPlayback("drums", undefined)).toEqual({ pitch: 0, mode: -1 });
  });

  it("vocals default to Soloist Monophonic", () => {
    expect(stemPlayback("vocals", -5)).toEqual({ pitch: -5, mode: SHIFTER_MODES.soloist });
  });

  it("KV-style 'lead vocal' stem counts as vocal", () => {
    expect(stemPlayback("lead vocal", -5)).toEqual({ pitch: -5, mode: SHIFTER_MODES.soloist });
  });

  it("bass and other default to Pro Normal", () => {
    expect(stemPlayback("bass", -5)).toEqual({ pitch: -5, mode: SHIFTER_MODES.pro });
    expect(stemPlayback("other", -5)).toEqual({ pitch: -5, mode: SHIFTER_MODES.pro });
  });

  it("drums stay unshifted by default even when the song transposes", () => {
    expect(stemPlayback("drums", -5)).toEqual({ pitch: 0, mode: -1 });
  });

  it("a zero-step spec leaves every stem untouched", () => {
    expect(stemPlayback("vocals", { from: "G", to: "G" })).toEqual({ pitch: 0, mode: -1 });
  });

  it("key-pair form infers steps", () => {
    expect(stemPlayback("vocals", { from: "G", to: "D" })).toEqual({
      pitch: -5,
      mode: SHIFTER_MODES.soloist,
    });
  });

  it("per-stem steps override (bass up a fifth instead of down a fourth)", () => {
    const spec = { from: "G", to: "D", stems: { bass: 7 } };
    expect(stemPlayback("bass", spec)).toEqual({ pitch: 7, mode: SHIFTER_MODES.pro });
    expect(stemPlayback("vocals", spec)).toEqual({ pitch: -5, mode: SHIFTER_MODES.soloist });
  });

  it("per-stem override can shift drums (out-of-key bleed case)", () => {
    const spec = { steps: -5, stems: { drums: -5 } };
    expect(stemPlayback("drums", spec)).toEqual({ pitch: -5, mode: SHIFTER_MODES.pro });
  });

  it("per-stem override to 0 silences the shift for that stem", () => {
    const spec = { steps: -5, stems: { other: 0 } };
    expect(stemPlayback("other", spec)).toEqual({ pitch: 0, mode: -1 });
  });

  it("shifter override by name", () => {
    const spec = { steps: -5, shifters: { vocals: "pro-formants" } };
    expect(stemPlayback("vocals", spec)).toEqual({
      pitch: -5,
      mode: SHIFTER_MODES["pro-formants"],
    });
  });

  it("shifter override by raw pitchmode int (escape hatch)", () => {
    const spec = { steps: -5, shifters: { vocals: 851969 } };
    expect(stemPlayback("vocals", spec)).toEqual({ pitch: -5, mode: 851969 });
  });

  it("throws on an unknown shifter name", () => {
    expect(() => stemPlayback("vocals", { steps: -5, shifters: { vocals: "melodyne" } })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Manifest schema: `transpose` accepts semitones or a key pair.
// ---------------------------------------------------------------------------

function validManifest(): any {
  return {
    schema: "clickbait/song@1",
    title: "Creep",
    artist: "Radiohead",
    key: "G",
    bpm: 92,
    timeSignature: [4, 4],
    sources: {
      recording: {
        kind: "audio",
        file: "source.m4a",
        beatMap: [{ startBeat: 0, times: [0, 0.65, 1.3] }],
      },
      stems: {
        kind: "audio-group",
        curveRef: "recording",
        dir: "stems/",
        files: {
          vocals: "source_vocals.wav",
          drums: "source_drums.wav",
          bass: "source_bass.wav",
          other: "source_other.wav",
        },
      },
    },
    songCurve: "constantBpm",
    sections: [{ name: "Verse 1", bars: 4 }],
    lyrics: {},
  };
}

describe("manifest transpose field", () => {
  it("accepts the semitone form", () => {
    const m = { ...validManifest(), transpose: -5 };
    expect(SongManifestSchema.parse(m).transpose).toBe(-5);
  });

  it("accepts the key-pair form", () => {
    const m = { ...validManifest(), transpose: { from: "G", to: "D" } };
    expect(SongManifestSchema.parse(m).transpose).toEqual({ from: "G", to: "D" });
  });

  it("accepts explicit steps with per-stem and shifter overrides", () => {
    const m = {
      ...validManifest(),
      transpose: { steps: -5, stems: { bass: 7, drums: 0 }, shifters: { vocals: "pro-formants" } },
    };
    expect(() => SongManifestSchema.parse(m)).not.toThrow();
  });

  it("rejects both steps and a key pair (ambiguous)", () => {
    const m = { ...validManifest(), transpose: { steps: -5, from: "G", to: "D" } };
    expect(() => SongManifestSchema.parse(m)).toThrow();
  });

  it("rejects an empty object (no steps, no key pair)", () => {
    const m = { ...validManifest(), transpose: {} };
    expect(() => SongManifestSchema.parse(m)).toThrow();
  });

  it("rejects a from without a to", () => {
    const m = { ...validManifest(), transpose: { from: "G" } };
    expect(() => SongManifestSchema.parse(m)).toThrow();
  });

  it("stays optional — a manifest without it still parses", () => {
    expect(SongManifestSchema.parse(validManifest()).transpose).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// manifestToSong: transpose lands on the stem audio nodes and the prep tone.
// ---------------------------------------------------------------------------

function findAudioNodes(node: any, out: any[] = []): any[] {
  if (node.kind === "audio") out.push(node);
  for (const c of node.children ?? []) findAudioNodes(c, out);
  return out;
}

function findCues(node: any, out: any[] = []): any[] {
  if (node.kind === "event" && node.type === "cue") out.push(node);
  for (const c of node.children ?? []) findCues(c, out);
  return out;
}

describe("manifestToSong transpose plumbing", () => {
  it("stamps per-stem pitch and shifter mode on the audio nodes", () => {
    const m = SongManifestSchema.parse({ ...validManifest(), transpose: { from: "G", to: "D" } });
    const s: any = manifestToSong(m, "/x");
    const byName = new Map(findAudioNodes(s).map((a) => [a.name.toLowerCase(), a]));
    expect(byName.get("vocals").pitch).toBe(-5);
    expect(byName.get("vocals").pitchMode).toBe(SHIFTER_MODES.soloist);
    expect(byName.get("bass").pitch).toBe(-5);
    expect(byName.get("bass").pitchMode).toBe(SHIFTER_MODES.pro);
    expect(byName.get("drums").pitch).toBeUndefined();
    expect(byName.get("drums").pitchMode).toBeUndefined();
  });

  it("leaves audio nodes untouched without a transpose", () => {
    const m = SongManifestSchema.parse(validManifest());
    const s: any = manifestToSong(m, "/x");
    for (const a of findAudioNodes(s)) {
      expect(a.pitch).toBeUndefined();
      expect(a.pitchMode).toBeUndefined();
    }
  });

  it("transposes prep-tone cue notes with the song", () => {
    const base = validManifest();
    base.sections[0].cues = [{ at: -4, tone: ["F#3", "A#3", "C#4"], bars: 1 }];
    const m = SongManifestSchema.parse({ ...base, transpose: -5 });
    const s: any = manifestToSong(m, "/x");
    const tones = findCues(s).filter((c) => c.tone);
    expect(tones).toHaveLength(1);
    expect(tones[0].tone).toEqual(["C#3", "F3", "G#3"]);
  });
});

// ---------------------------------------------------------------------------
// buildRpp: pitch + mode reach the item PLAYRATE line; absence is byte-stable.
// ---------------------------------------------------------------------------

describe("buildRpp transpose emission", () => {
  const vocalsPath = resolve(fixturesDir, "stems", "vocals.wav");
  const bassPath = resolve(fixturesDir, "stems", "bass.wav");
  const defaultOpts = {
    cueDir: resolve(fixturesDir, "cues"),
    countDir: resolve(__dirname, "..", "assets", "counts"),
    clickDir: resolve(__dirname, "..", "assets", "clicks"),
  };

  it("emits pitch and shifter mode in PLAYRATE for a transposed stem", () => {
    const s = song("Test", 92,
      seq(span("Verse", bars(4))),
      audio("Vocals", vocalsPath, { pitch: -5, pitchMode: 720896 }),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    expect(rpp).toContain("PLAYRATE 1 1 -5 720896 0 0.0025");
  });

  it("emits per-stem values independently", () => {
    const s = song("Test", 92,
      seq(span("Verse", bars(4))),
      audio("Vocals", vocalsPath, { pitch: -5, pitchMode: 720896 }),
      audio("Bass", bassPath, { pitch: 7, pitchMode: 589824 }),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    expect(rpp).toContain("PLAYRATE 1 1 -5 720896 0 0.0025");
    expect(rpp).toContain("PLAYRATE 1 1 7 589824 0 0.0025");
  });

  it("emits today's exact line when no pitch is set", () => {
    const s = song("Test", 92,
      seq(span("Verse", bars(4))),
      audio("Vocals", vocalsPath),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    const stemLines = rpp.split("\n").filter((l) => l.includes("PLAYRATE 1 1"));
    for (const l of stemLines) expect(l.trim()).toBe("PLAYRATE 1 1 0 -1 0 0.0025");
  });
});
