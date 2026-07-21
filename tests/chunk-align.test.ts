import { describe, it, expect } from "vitest";
import { assignChunks, groupByChunk, alignSequences, normWord, type HeardWord, type ChunkDur } from "../src/authoring/chunk-align.js";

const heard = (pairs: [string, number][]): HeardWord[] => pairs.map(([text, chunk]) => ({ text, chunk }));
/** Equal-duration chunks 0..n-1 (distribution then depends only on counts). */
const evenChunks = (n: number): ChunkDur[] => Array.from({ length: n }, (_, i) => ({ index: i, durationMs: 1000 }));

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
    expect(assignChunks(published, h, evenChunks(2))).toEqual([0, 0, 0, 1, 1]);
  });

  it("Whisper substitution — the misheard word inherits its neighbors' chunk", () => {
    const published = ["the", "world", "was", "on", "fire"];
    // "world" misheard as "whirled" -> no exact match; both neighbors anchor to 0.
    const h = heard([["the", 0], ["whirled", 0], ["was", 0], ["on", 1], ["fire", 1]]);
    expect(assignChunks(published, h, evenChunks(2))).toEqual([0, 0, 0, 1, 1]);
  });

  it("Whisper deletion — dropped word still assigned by neighbors", () => {
    const published = ["the", "world", "was", "on", "fire"];
    const h = heard([["the", 0], ["was", 0], ["on", 1], ["fire", 1]]); // "world" not heard
    expect(assignChunks(published, h, evenChunks(2))).toEqual([0, 0, 0, 1, 1]);
  });

  it("repeated line — each occurrence maps to its OWN chunk, not the first", () => {
    const published = ["fall", "in", "love", "fall", "in", "love"];
    const h = heard([
      ["fall", 1], ["in", 1], ["love", 1],
      ["fall", 3], ["in", 3], ["love", 3],
    ]);
    expect(assignChunks(published, h, evenChunks(4))).toEqual([1, 1, 1, 3, 3, 3]);
  });

  it("bleed chunk — non-lyric noise matches nothing and gets no words", () => {
    const published = ["hello", "world"];
    const h = heard([["(whistling)", 0], ["hello", 1], ["world", 1]]);
    const chunkOf = assignChunks(published, h, evenChunks(2));
    expect(chunkOf).toEqual([1, 1]);
    // chunk 0 (the whistling) owns no published words.
    expect(groupByChunk(chunkOf)).toEqual([{ chunk: 1, from: 0, to: 1 }]);
  });

  it("fully-misheard middle line spreads across the middle chunks, not dumped on the previous", () => {
    // Anchors only at the ends (chunk 0 and chunk 2); the 3 middle words were
    // misheard entirely. They must NOT all pile on chunk 0 (the overflow bug).
    const published = ["x", "m1", "m2", "m3", "y"];
    const h = heard([["x", 0], ["y", 2]]);
    const chunkOf = assignChunks(published, h, evenChunks(3));
    expect(chunkOf).toEqual([0, 0, 1, 2, 2]);
    // the middle word landed in the middle chunk
    expect(chunkOf[2]).toBe(1);
  });

  it("words before the first anchor go to the first ANCHORED chunk, not a leading (bleed) chunk", () => {
    // chunk 0 is a leading instrumental/bleed chunk with no lyric match; the
    // first (trusted, 2-word) anchor is in chunk 2. "with" must land in chunk 2.
    const published = ["with", "your", "feet"];
    const h = heard([["your", 2], ["feet", 2]]); // a trusted run in chunk 2
    expect(assignChunks(published, h, evenChunks(3))).toEqual([2, 2, 2]);
  });

  it("words after the last anchor go to the last anchored chunk", () => {
    const published = ["hold", "on", "oh", "oh"];
    const h = heard([["hold", 1], ["on", 1]]); // trusted run in chunk 1
    expect(assignChunks(published, h, evenChunks(4))).toEqual([1, 1, 1, 1]);
  });

  it("drops a lone false anchor (hallucinated word on a bleed chunk) and distributes instead", () => {
    // "with" was hallucinated on bleed chunk 0; the real line matches in a run
    // in chunk 2. The lone chunk-0 match must NOT latch "with" to chunk 0.
    const published = ["with", "your", "feet", "in", "the", "air"];
    const h = heard([
      ["with", 0], // lone false anchor on intro bleed
      ["your", 2], ["feet", 2], ["in", 2], ["the", 2], ["air", 2], // real run
    ]);
    const chunkOf = assignChunks(published, h, evenChunks(3));
    expect(chunkOf[0]).toBe(2); // "with" clamps to the first REAL anchored chunk, not chunk 0
    expect(chunkOf).toEqual([2, 2, 2, 2, 2, 2]);
  });

  it("duration weighting keeps words off a tiny chunk", () => {
    // chunk 1 is tiny (short audio); a run of unanchored words between chunk 0
    // and chunk 2 should mostly avoid it.
    const published = ["x", "a", "b", "c", "d", "y"];
    const h = heard([["x", 0], ["y", 2]]);
    const chunks: ChunkDur[] = [
      { index: 0, durationMs: 1000 },
      { index: 1, durationMs: 40 }, // tiny
      { index: 2, durationMs: 1000 },
    ];
    const chunkOf = assignChunks(published, h, chunks);
    // no more than one of the four middle words on the tiny chunk 1
    expect(chunkOf.filter((c) => c === 1).length).toBeLessThanOrEqual(1);
    // and the assignment stays monotonic
    for (let i = 1; i < chunkOf.length; i++) expect(chunkOf[i]! >= chunkOf[i - 1]!).toBe(true);
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
