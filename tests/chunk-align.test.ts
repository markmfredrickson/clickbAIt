import { describe, it, expect } from "vitest";
import { assignChunks, groupByChunk, alignSequences, normWord, type HeardWord } from "../src/authoring/chunk-align.js";

const heard = (pairs: [string, number][]): HeardWord[] => pairs.map(([text, chunk]) => ({ text, chunk }));

describe("normWord", () => {
  it("lowercases and strips non-alphanumerics", () => {
    expect(normWord("Fire,")).toBe("fire");
    expect(normWord("(whistling)")).toBe("whistling");
    expect(normWord("don't")).toBe("dont");
  });
});

describe("assignChunks", () => {
  it("clean 1:1 — each word lands in its heard chunk", () => {
    const published = ["the", "world", "was", "on", "fire"];
    const h = heard([["the", 0], ["world", 0], ["was", 0], ["on", 1], ["fire", 1]]);
    expect(assignChunks(published, h)).toEqual([0, 0, 0, 1, 1]);
  });

  it("Whisper substitution — the misheard word inherits its neighbors' chunk", () => {
    const published = ["the", "world", "was", "on", "fire"];
    // "world" misheard as "whirled" -> no exact match, filled from neighbors.
    const h = heard([["the", 0], ["whirled", 0], ["was", 0], ["on", 1], ["fire", 1]]);
    expect(assignChunks(published, h)).toEqual([0, 0, 0, 1, 1]);
  });

  it("Whisper deletion — dropped word still assigned by neighbors", () => {
    const published = ["the", "world", "was", "on", "fire"];
    const h = heard([["the", 0], ["was", 0], ["on", 1], ["fire", 1]]); // "world" not heard
    expect(assignChunks(published, h)).toEqual([0, 0, 0, 1, 1]);
  });

  it("repeated line — each occurrence maps to its OWN chunk, not the first", () => {
    const published = ["fall", "in", "love", "fall", "in", "love"];
    const h = heard([
      ["fall", 1], ["in", 1], ["love", 1],
      ["fall", 3], ["in", 3], ["love", 3],
    ]);
    expect(assignChunks(published, h)).toEqual([1, 1, 1, 3, 3, 3]);
  });

  it("bleed chunk — non-lyric noise matches nothing and gets no words", () => {
    const published = ["hello", "world"];
    const h = heard([["(whistling)", 0], ["hello", 1], ["world", 1]]);
    const chunkOf = assignChunks(published, h);
    expect(chunkOf).toEqual([1, 1]);
    // chunk 0 (the whistling) owns no published words.
    expect(groupByChunk(chunkOf)).toEqual([{ chunk: 1, from: 0, to: 1 }]);
  });
});

describe("groupByChunk", () => {
  it("collapses a chunk assignment into contiguous spans", () => {
    expect(groupByChunk([0, 0, 1, 1, 1, 3, 3])).toEqual([
      { chunk: 0, from: 0, to: 1 },
      { chunk: 1, from: 2, to: 4 },
      { chunk: 3, from: 5, to: 6 },
    ]);
  });

  it("skips null (unassigned) words", () => {
    expect(groupByChunk([null, 0, 0, null, 2])).toEqual([
      { chunk: 0, from: 1, to: 2 },
      { chunk: 2, from: 4, to: 4 },
    ]);
  });
});

describe("alignSequences", () => {
  it("returns exact-match heard indices, -1 for gaps/mismatches", () => {
    // published: a b c ; heard: a x b c  -> a@0, b@2, c@3
    expect(alignSequences(["a", "b", "c"], ["a", "x", "b", "c"])).toEqual([0, 2, 3]);
  });
});
