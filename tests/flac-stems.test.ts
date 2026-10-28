import { describe, it, expect } from "vitest";
import { flacStemRefs } from "../src/build/flac-stems.js";

describe("flacStemRefs", () => {
  const names = ["source_vocals", "source_drums", "Song [abc]_bass"];

  it("renames the converted stems in a recipe's commands, files, outputs and stem glob", () => {
    const recipe = JSON.stringify({
      split: { output: ["stems/source_vocals.wav", "stems/source_drums.wav"] },
      beats: { command: "bin beats stems/source_drums.wav > x", files: ["stems/source_drums.wav"] },
      features: { files: ["song.song.json", "stems/*.wav"] },
    });
    expect(JSON.parse(flacStemRefs(recipe, names))).toEqual({
      split: { output: ["stems/source_vocals.flac", "stems/source_drums.flac"] },
      beats: { command: "bin beats stems/source_drums.flac > x", files: ["stems/source_drums.flac"] },
      features: { files: ["song.song.json", "stems/*.flac"] },
    });
  });

  it("renames the manifest's stem files, names with brackets included", () => {
    const manifest = `"files": { "vocals": "source_vocals.wav", "bass": "Song [abc]_bass.wav" }`;
    expect(flacStemRefs(manifest, names)).toBe(`"files": { "vocals": "source_vocals.flac", "bass": "Song [abc]_bass.flac" }`);
  });

  it("leaves other WAVs alone", () => {
    const text = `cues/verse.wav click/accent.wav "source_other.wav" kv/lead-vocal.wav`;
    expect(flacStemRefs(text, names)).toBe(text);
  });
});
