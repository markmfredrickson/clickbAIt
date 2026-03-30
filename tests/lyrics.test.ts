import { describe, it, expect } from "vitest";
import type { Word, Phrase } from "@clickbait/dsongl";
import {
  secondsToBeats,
  quantize,
  groupIntoPhrases,
  buildTranscriptionPhrase,
} from "../src/transcribe.js";

// ── secondsToBeats ─────────────────────────────────────────────

describe("secondsToBeats", () => {
  it("converts at 120 BPM", () => {
    expect(secondsToBeats(1, 120)).toBe(2);
    expect(secondsToBeats(0.5, 120)).toBe(1);
    expect(secondsToBeats(0, 120)).toBe(0);
  });

  it("1 beat per second at 60 BPM", () => {
    expect(secondsToBeats(1, 60)).toBe(1);
    expect(secondsToBeats(4, 60)).toBe(4);
  });

  it("handles non-standard BPM", () => {
    expect(secondsToBeats(60, 97)).toBe(97);
  });
});

// ── quantize ───────────────────────────────────────────────────

describe("quantize", () => {
  it("snaps to 16th note grid by default", () => {
    expect(quantize(1.1)).toBe(1);
    expect(quantize(1.13)).toBe(1.25);
    expect(quantize(1.87)).toBe(1.75);
    expect(quantize(2.0)).toBe(2.0);
  });

  it("snaps to custom grid", () => {
    expect(quantize(1.3, 0.5)).toBe(1.5);
    expect(quantize(1.7, 1)).toBe(2);
  });
});

// ── groupIntoPhrases ───────────────────────────────────────────

describe("groupIntoPhrases", () => {
  const bpm = 120; // 2 beats/sec, 1 beat = 500ms

  it("groups consecutive words into one phrase", () => {
    const words: Word[] = [
      { text: "just", startMs: 0, endMs: 200, confidence: 0.9 },
      { text: "a", startMs: 220, endMs: 300, confidence: 0.95 },
      { text: "small", startMs: 320, endMs: 500, confidence: 0.8 },
      { text: "town", startMs: 520, endMs: 700, confidence: 0.85 },
      { text: "girl", startMs: 720, endMs: 900, confidence: 0.9 },
    ];
    const phrases = groupIntoPhrases(words, bpm);
    expect(phrases).toHaveLength(1);
    expect(phrases[0].map((w) => w.text).join(" ")).toBe("just a small town girl");
  });

  it("splits on gaps longer than 1 beat", () => {
    const words: Word[] = [
      { text: "hello", startMs: 0, endMs: 300 },
      { text: "world", startMs: 900, endMs: 1200 }, // 600ms gap = 1.2 beats
    ];
    const phrases = groupIntoPhrases(words, bpm);
    expect(phrases).toHaveLength(2);
    expect(phrases[0][0].text).toBe("hello");
    expect(phrases[1][0].text).toBe("world");
  });

  it("splits after sentence-ending punctuation", () => {
    const words: Word[] = [
      { text: "first.", startMs: 0, endMs: 300, confidence: 0.9 },
      { text: "second", startMs: 350, endMs: 600, confidence: 0.9 },
    ];
    const phrases = groupIntoPhrases(words, bpm);
    expect(phrases).toHaveLength(2);
  });

  it("returns empty for empty input", () => {
    expect(groupIntoPhrases([], bpm)).toEqual([]);
  });

  it("handles a single word", () => {
    const words: Word[] = [
      { text: "hey", startMs: 1000, endMs: 1500 },
    ];
    const phrases = groupIntoPhrases(words, bpm);
    expect(phrases).toHaveLength(1);
    expect(phrases[0][0].startMs).toBe(1000);
  });

  it("respects BPM for gap calculation", () => {
    const words: Word[] = [
      { text: "slow", startMs: 0, endMs: 500 },
      { text: "song", startMs: 1400, endMs: 1900 }, // 900ms gap
    ];
    // At 60 BPM: 900ms = 0.9 beats → no split
    expect(groupIntoPhrases(words, 60)).toHaveLength(1);
    // At 120 BPM: 900ms = 1.8 beats → split
    expect(groupIntoPhrases(words, 120)).toHaveLength(2);
  });

  it("preserves per-word timing through grouping", () => {
    const words: Word[] = [
      { text: "don't", startMs: 0, endMs: 200, confidence: 0.9 },
      { text: "stop", startMs: 220, endMs: 400, confidence: 0.85 },
    ];
    const phrases = groupIntoPhrases(words, bpm);
    // Individual word timing survives grouping
    expect(phrases[0][0].startMs).toBe(0);
    expect(phrases[0][1].startMs).toBe(220);
    expect(phrases[0][1].confidence).toBe(0.85);
  });
});

// ── beat offset calculation ────────────────────────────────────

describe("beat offset from phrase", () => {
  it("uses first word startMs for phrase beat position", () => {
    const phrase: Phrase = [
      { text: "don't", startMs: 1500, endMs: 1700 },
      { text: "stop", startMs: 1720, endMs: 1900 },
    ];
    const bpm = 120;
    const beat = quantize(secondsToBeats(phrase[0].startMs / 1000, bpm));
    expect(beat).toBe(3); // 1.5s × 2 beats/s = 3 beats
  });

  it("quantizes at 97 BPM", () => {
    // 2000ms at 97 BPM = 3.233 beats → 3.25
    const beat = quantize(secondsToBeats(2, 97));
    expect(beat).toBe(3.25);
  });
});

// ── buildTranscriptionPhrase ───────────────────────────────────

describe("buildTranscriptionPhrase", () => {
  it("computes average confidence", () => {
    const words: Word[] = [
      { text: "hello", startMs: 0, endMs: 200, confidence: 0.8 },
      { text: "world", startMs: 220, endMs: 400, confidence: 0.6 },
    ];
    const phrase = buildTranscriptionPhrase(words);
    expect(phrase.avgConfidence).toBe(0.7);
  });

  it("identifies low confidence words", () => {
    const words: Word[] = [
      { text: "clear", startMs: 0, endMs: 200, confidence: 0.9 },
      { text: "mumble", startMs: 220, endMs: 400, confidence: 0.3 },
      { text: "ok", startMs: 420, endMs: 500, confidence: 0.7 },
    ];
    const phrase = buildTranscriptionPhrase(words);
    expect(phrase.lowConfidenceWords).toHaveLength(1);
    expect(phrase.lowConfidenceWords[0]).toContain("mumble");
    expect(phrase.lowConfidenceWords[0]).toContain("30%");
  });

  it("joins word text with spaces", () => {
    const words: Word[] = [
      { text: "just", startMs: 0, endMs: 100, confidence: 0.9 },
      { text: "a", startMs: 120, endMs: 150, confidence: 0.9 },
      { text: "girl", startMs: 170, endMs: 300, confidence: 0.9 },
    ];
    const phrase = buildTranscriptionPhrase(words);
    expect(phrase.text).toBe("just a girl");
  });

  it("uses first word startMs", () => {
    const words: Word[] = [
      { text: "hey", startMs: 500, endMs: 700, confidence: 0.9 },
      { text: "now", startMs: 720, endMs: 900, confidence: 0.9 },
    ];
    const phrase = buildTranscriptionPhrase(words);
    expect(phrase.startMs).toBe(500);
  });

  it("handles words with undefined confidence", () => {
    const words: Word[] = [
      { text: "word", startMs: 0, endMs: 200 },
    ];
    const phrase = buildTranscriptionPhrase(words);
    expect(phrase.avgConfidence).toBe(0);
    expect(phrase.lowConfidenceWords).toHaveLength(1);
  });

  it("respects custom minConfidence threshold", () => {
    const words: Word[] = [
      { text: "word", startMs: 0, endMs: 200, confidence: 0.6 },
    ];
    // Default threshold (0.5) — should pass
    expect(buildTranscriptionPhrase(words).lowConfidenceWords).toHaveLength(0);
    // Higher threshold — should flag
    expect(buildTranscriptionPhrase(words, 0.7).lowConfidenceWords).toHaveLength(1);
  });
});
