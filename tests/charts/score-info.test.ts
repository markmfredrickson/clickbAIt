import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readScoreInfo } from "../../src/charts/score-info.js";

// A synthetic 4-bar score (no copyrighted transcription in the repo):
// guitar tab with markers "Intro" at bar 1 and "Verse" at bar 3, bass tab,
// and a drum track.
const FIXTURE = resolve(import.meta.dirname, "../fixtures/charts/three-tracks.atex");

describe("readScoreInfo", () => {
  const info = readScoreInfo(new Uint8Array(readFileSync(FIXTURE)), "three-tracks.atex");

  it("counts the score's bars", () => {
    expect(info.bars).toBe(4);
  });

  it("lists tracks in order with the kind of staff each one is", () => {
    expect(info.tracks).toEqual([
      { name: "Guitar", kind: "tab" },
      { name: "Bass", kind: "tab" },
      { name: "Drums", kind: "drums" },
    ]);
  });

  it("lists section markers with their 1-based bar numbers", () => {
    expect(info.markers).toEqual([
      { bar: 1, text: "Intro" },
      { bar: 3, text: "Verse" },
    ]);
  });

  it("gives identical bars the same signature and different bars different ones", () => {
    const [guitar, , drums] = info.signatures;
    expect(guitar[0]).toBe(guitar[1]);
    expect(guitar[2]).not.toBe(guitar[0]);
    // Drums: a kick-snare bar, then three bars of rest.
    expect(new Set(drums.slice(1)).size).toBe(1);
    expect(drums[0]).not.toBe(drums[1]);
  });

  it("rejects a file it can't read, naming the file", () => {
    expect(() => readScoreInfo(new TextEncoder().encode("not a score"), "junk.gp5")).toThrow(/junk\.gp5/);
  });
});
