import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { alignSource, songRecipe, upgradeAlign } from "../src/build/song-recipe.js";
import { lyricsTextFromManifest } from "../src/authoring/scaffold.js";

type Task = { command: string; files?: string[]; output?: string[]; dependencies?: string[] };
type Recipe = { scripts: Record<string, string>; wireit: Record<string, Task> };

const base = { slug: "song", title: "Song", artist: "Band", rel: "../../..", minBpm: 100, maxBpm: 120 };
const DESILENCE = "npx tsx ../../../src/authoring/desilence-align-cli.ts";

describe("songRecipe: align", () => {
  it("aligns a split song's vocal stem with desilence-align, keeping its segment map", () => {
    const { wireit } = songRecipe(base) as Recipe;
    expect(wireit.align).toEqual({
      command: `${DESILENCE} "stems/source_vocals.flac" --text "song.lyrics.txt" -o "stems/source_vocals.align.json" --debug "stems/source_vocals.desilence.json"`,
      files: ["stems/source_vocals.flac", "song.lyrics.txt"],
      output: ["stems/source_vocals.align.json", "stems/source_vocals.desilence.json"],
      dependencies: ["split", "lyrics-txt"],
    });
  });

  it("aligns a multitrack song's lead vocal track, with lyric text from the manifest", () => {
    const { scripts, wireit } = songRecipe({ ...base, alignStem: "kv/lead-vocal.mp3", alignFile: "kv/lead-vocal.align.json", lyricsFrom: "manifest" }) as Recipe;
    expect(scripts.align).toBe("wireit");
    expect(wireit.align.command).toBe(`${DESILENCE} "kv/lead-vocal.mp3" --text "song.lyrics.txt" -o "kv/lead-vocal.align.json" --debug "kv/lead-vocal.desilence.json"`);
    expect(wireit.align.dependencies).toEqual(["lyrics-txt"]);
    expect(wireit["lyrics-txt"]).toEqual({
      command: "npx tsx ../../../src/authoring/lyrics-text-cli.ts --manifest song.song.json song.lyrics.txt",
      files: ["song.song.json"],
      output: ["song.lyrics.txt"],
    });
  });

  it("keeps align out of the build's dependencies: the build reads the alignment file", () => {
    const { wireit } = songRecipe(base) as Recipe;
    expect(wireit.build.dependencies).not.toContain("align");
  });
});

describe("lyricsTextFromManifest", () => {
  it("joins every section's lyric lines in order, one per line", () => {
    const manifest = { sections: [{ name: "Intro" }, { name: "Verse", lines: [{ text: "one two" }, { text: "three" }] }, { name: "Chorus", lines: [{ text: "four" }] }] };
    expect(lyricsTextFromManifest(manifest)).toBe("one two\nthree\nfour");
  });
});

describe("upgradeAlign: an existing recipe", () => {
  // A split song's recipe from before split and lyrics-txt were tasks.
  const old = (): Recipe => ({
    scripts: { beats: "wireit", align: "wireit", build: "wireit" },
    wireit: {
      beats: { command: "beats" },
      align: {
        command: '../../../.claude/skills/clickbait/bin/clickbait-audio align "stems/source_vocals.wav" --text "song.lyrics.txt" -o "stems/source_vocals.align.json"',
        files: ["stems/source_vocals.wav", "song.lyrics.txt"],
        output: ["stems/source_vocals.align.json"],
      },
      build: { command: "build", dependencies: ["align"] },
    },
  });
  const split = { rel: "../../..", slug: "song", alignStem: "stems/source_vocals.wav", alignFile: "stems/source_vocals.align.json", lyricsFrom: "lookup" as const };

  it("swaps the binary aligner for desilence-align, depending only on tasks the recipe has", () => {
    const r = upgradeAlign(old(), split) as Recipe;
    expect(r.wireit.align.command).toContain("desilence-align-cli.ts");
    expect(r.wireit.align.output).toEqual(["stems/source_vocals.align.json", "stems/source_vocals.desilence.json"]);
    expect(r.wireit.align.dependencies).toBeUndefined();
  });

  it("leaves the song's other tasks alone", () => {
    const r = upgradeAlign(old(), split) as Recipe;
    expect([r.wireit.beats, r.wireit.build]).toEqual([old().wireit.beats, old().wireit.build]);
  });

  it("gives a multitrack recipe with no align task one, and the lyrics-txt task it reads", () => {
    const kv: Recipe = { scripts: { build: "wireit" }, wireit: { build: { command: "build" } } };
    const r = upgradeAlign(kv, { rel: "../../..", slug: "song", alignStem: "kv/lead-vocal.mp3", alignFile: "kv/lead-vocal.align.json", lyricsFrom: "manifest" }) as Recipe;
    expect([r.scripts.align, r.scripts["lyrics-txt"]]).toEqual(["wireit", "wireit"]);
    expect(r.wireit.align.dependencies).toEqual(["lyrics-txt"]);
    expect(r.wireit["lyrics-txt"].command).toContain("--manifest song.song.json");
  });

  it("refuses an align command it doesn't recognize, rather than overwrite something hand-tuned", () => {
    const custom = old();
    custom.wireit.align.command = "my-own-aligner";
    expect(() => upgradeAlign(custom, split)).toThrow(/don't recognize/);
  });

  it("is a no-op on a recipe already upgraded", () => {
    const once = upgradeAlign(old(), split);
    expect(upgradeAlign(once, split)).toEqual(once);
  });
});

describe("alignSource", () => {
  const dirWith = (files: string[]) => {
    const dir = mkdtempSync(join(tmpdir(), "align-source-"));
    for (const f of files) {
      mkdirSync(join(dir, dirname(f)), { recursive: true });
      writeFileSync(join(dir, f), "");
    }
    return dir;
  };

  it("aligns a split song's vocal stem against the lookup lyrics", () => {
    const dir = dirWith(["stems/source_vocals.wav"]);
    const m = { lyrics: { alignment: { file: "stems/source_vocals.align.json" } }, sources: { stems: { dir: "stems/", files: { vocals: "source_vocals.wav" } } } };
    expect(alignSource(dir, m)).toEqual({ alignStem: "stems/source_vocals.wav", alignFile: "stems/source_vocals.align.json", lyricsFrom: "lookup" });
  });

  it("aligns a multitrack song's audio beside its alignment file against the manifest's lines", () => {
    const dir = dirWith(["kv/lead-vocal.mp3"]);
    const m = { lyrics: { alignment: { file: "kv/lead-vocal.align.json" } }, sources: { stems: { dir: "kv/", files: { "lead vocal": "lead-vocal.mp3" } } } };
    expect(alignSource(dir, m)).toEqual({ alignStem: "kv/lead-vocal.mp3", alignFile: "kv/lead-vocal.align.json", lyricsFrom: "manifest" });
  });

  it("has none without an alignment file or vocal audio", () => {
    expect(alignSource(dirWith([]), { lyrics: {} })).toBeNull();
    expect(alignSource(dirWith([]), { lyrics: { alignment: { file: "kv/lead-vocal.align.json" } } })).toBeNull();
  });
});

describe("songRecipe: stems", () => {
  it("splits into FLAC stems, which the features task reads", () => {
    const { wireit } = songRecipe(base) as Recipe;
    expect(wireit.split.output).toEqual([
      "stems/source_drums.flac",
      "stems/source_bass.flac",
      "stems/source_other.flac",
      "stems/source_vocals.flac",
    ]);
    expect(wireit.features.files).toContain("stems/*.flac");
  });
});

describe("songRecipe: beats", () => {
  it("detects on the drum stem and the full mix, then merges them over the drum stem's silences", () => {
    const { wireit } = songRecipe(base) as Recipe;
    const bin = "../../../.claude/skills/clickbait/bin/clickbait-audio";
    expect(wireit.beats).toEqual({
      command:
        `${bin} beats stems/source_drums.flac --min-bpm 100 --max-bpm 120 > source.m4a.drums.beats.json` +
        ` && ${bin} beats source.m4a --activation spectral-flux --min-bpm 100 --max-bpm 120 > source.m4a.fullmix.beats.json` +
        ` && npx tsx ../../../src/authoring/unify-beats-cli.ts source.m4a.fullmix.beats.json source.m4a.drums.beats.json stems/source_drums.flac source.m4a.beats.json`,
      files: ["stems/source_drums.flac", "source.m4a"],
      output: ["source.m4a.drums.beats.json", "source.m4a.fullmix.beats.json", "source.m4a.beats.json"],
      dependencies: ["split"],
    });
  });
});
