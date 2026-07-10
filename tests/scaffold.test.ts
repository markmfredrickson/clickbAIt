import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  lyricBlockFromLookup,
  parseGeniusSections,
  lyricsTextFromLookup,
  foldBeats,
  buildScaffold,
} from "../src/authoring/scaffold.js";
import { SongManifestSchema } from "../src/manifest.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (f: string) => resolve(here, "fixtures/lorem-ipsum", f);
const lookupText = readFileSync(fixture("lorem-ipsum.lookup.json"), "utf8");

describe("lyricBlockFromLookup", () => {
  it("extracts the block between the sentinels", () => {
    const block = lyricBlockFromLookup(lookupText);
    expect(block.startsWith("[Intro]")).toBe(true);
    expect(block).toContain("[Verse 1]");
    expect(block).not.toContain("---lyrics-raw---");
    expect(block).not.toContain("Deezer:");
  });

  it("returns empty string when there is no lyric block", () => {
    expect(lyricBlockFromLookup("Deezer: X by Y\n  BPM: 120")).toBe("");
  });
});

describe("parseGeniusSections", () => {
  const sections = parseGeniusSections(lyricBlockFromLookup(lookupText));

  it("splits into labeled sections in order", () => {
    expect(sections.map((s) => s.name)).toEqual([
      "Intro",
      "Verse 1",
      "Chorus",
      "Verse 2",
      "Chorus",
      "Outro",
    ]);
  });

  it("strips a featured-artist annotation from the label", () => {
    // Fixture has "[Verse 2: Testus Maximus]".
    expect(sections[3].name).toBe("Verse 2");
  });

  it("keeps only lyric lines, dropping headers and blanks", () => {
    expect(sections[1].lines).toEqual([
      "Lorem ipsum dolor sit amet",
      "Consectetur adipiscing elit",
      "Sed do eiusmod tempor incididunt",
      "Ut labore et dolore magna aliqua",
    ]);
    expect(sections[0].lines).toEqual([]); // instrumental [Intro]
    expect(sections[5].lines).toEqual([]); // [Outro]
  });
});

describe("lyricsTextFromLookup", () => {
  it("flattens all lyric lines in order, no headers or blanks", () => {
    const text = lyricsTextFromLookup(lookupText);
    const lines = text.split("\n");
    expect(lines).toHaveLength(10); // 4 + 2 + 2 + 2 lyric lines across the sections
    expect(text).not.toContain("[");
    expect(lines[0]).toBe("Lorem ipsum dolor sit amet");
    expect(lines[4]).toBe("Ut enim ad minim veniam"); // first Chorus line
  });
});

describe("foldBeats", () => {
  it("halves the tempo and keeps every other beat", () => {
    expect(foldBeats(120, [0, 0.5, 1.0, 1.5], "half")).toEqual({
      bpm: 60,
      times: [0, 1.0],
    });
  });

  it("respects the phase when folding half", () => {
    expect(foldBeats(120, [0, 0.5, 1.0, 1.5], "half", 1)).toEqual({
      bpm: 60,
      times: [0.5, 1.5],
    });
  });

  it("doubles the tempo and inserts midpoints", () => {
    expect(foldBeats(60, [0, 1.0, 2.0], "double")).toEqual({
      bpm: 120,
      times: [0, 0.5, 1.0, 1.5, 2.0],
    });
  });

  it("passes through with no mode", () => {
    expect(foldBeats(100, [0, 1], undefined)).toEqual({ bpm: 100, times: [0, 1] });
  });
});

describe("buildScaffold", () => {
  const inputs = {
    title: "Lorem Ipsum",
    artist: "Testus Maximus",
    bpm: 120,
    beats: [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5],
    sourceFile: "source.m4a",
    stems: {
      dir: "stems/",
      files: {
        vocals: "source_vocals.wav",
        drums: "source_drums.wav",
        bass: "source_bass.wav",
        other: "source_other.wav",
      },
    },
    alignFile: "stems/source_vocals.align.json",
    genius: lyricBlockFromLookup(lookupText),
  };

  it("produces a manifest that passes SongManifestSchema", () => {
    const manifest = buildScaffold(inputs);
    // buildScaffold parses internally; re-parse to prove the returned object is clean.
    expect(() => SongManifestSchema.parse(manifest)).not.toThrow();
    expect(manifest.schema).toBe("clickbait/song@1");
    expect(manifest.bpm).toBe(120);
    expect(manifest.sources.recording.beatMap).toEqual([
      { startBeat: 0, times: [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5] },
    ]);
    expect(manifest.sources.stems?.files.vocals).toBe("source_vocals.wav");
  });

  it("nests parsed lyric lines under their sections, tagged", () => {
    const manifest = buildScaffold(inputs);
    expect(manifest.sections.map((s) => s.name)).toEqual([
      "Intro",
      "Verse 1",
      "Chorus",
      "Verse 2",
      "Chorus",
      "Outro",
    ]);
    const verse1 = manifest.sections[1];
    expect(verse1.lines?.length).toBe(4);
    expect(verse1.lines?.[0]).toEqual({
      text: "Lorem ipsum dolor sit amet",
      tag: "Lead Vocal",
    });
    expect(manifest.sections[0].lines).toBeUndefined(); // instrumental
  });

  it("emits no sections when there is no Genius block", () => {
    const manifest = buildScaffold({ ...inputs, genius: undefined });
    expect(manifest.sections).toEqual([]);
  });

  it("folds bpm and grid consistently via foldBeats", () => {
    const folded = foldBeats(inputs.bpm, inputs.beats, "half");
    const manifest = buildScaffold({ ...inputs, bpm: folded.bpm, beats: folded.times });
    expect(manifest.bpm).toBe(60);
    expect(manifest.sources.recording.beatMap).toEqual([
      { startBeat: 0, times: [0, 1.0, 2.0, 3.0] },
    ]);
  });
});
