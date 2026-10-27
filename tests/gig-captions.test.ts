import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encoderDelay } from "../src/gig/media.js";
import { boardEnd, boardSpan, correctOffset, toVideoTime } from "../src/gig/timeline.js";
import { captionsSrt, strandedWords, type CaptionLine } from "../src/gig/srt.js";

describe("the video timeline", () => {
  it("cuts the board from where the video starts, for as long as the video runs on the board's clock", () => {
    const span = boardSpan({ offset: 100, drift_ppm: 50 }, 200);
    expect(span.start).toBe(100);
    expect(span.seconds).toBeCloseTo(200 * (1 + 50e-6), 9);
  });

  it("puts the end of a video where it stops on the board, on the board's clock", () => {
    expect(boardEnd({ offset: 100, drift_ppm: 50 }, 200)).toBeCloseTo(100 + 200 * (1 + 50e-6), 9);
    expect(boardEnd({ offset: -3, drift_ppm: null }, 200)).toBe(197);
  });

  it("cuts from the board's start when the video started first", () => {
    expect(boardSpan({ offset: -3, drift_ppm: null }, 200)).toEqual({ start: 0, seconds: 197 });
  });

  it("puts a time in the cut on the video's timeline, undoing the drift", () => {
    const sync = { offset: 100, drift_ppm: 50 };
    expect(toVideoTime(0, sync)).toBe(0);
    expect(toVideoTime(60 * (1 + 50e-6), sync)).toBeCloseTo(60, 9);
  });

  it("counts from the video's start when the video started before the board", () => {
    expect(toVideoTime(10, { offset: -3, drift_ppm: null })).toBe(13);
  });

  it("leaves times alone when the sound came from the phone itself", () => {
    expect(toVideoTime(42.5, null)).toBe(42.5);
  });

  it("moves the offset by the encoder delay each decoder left in", () => {
    // Both delays kept: they cancel. Only the board's: the board ran late.
    expect(correctOffset(100, 2112 / 48000, 2112 / 48000)).toBe(100);
    expect(correctOffset(100, 2112 / 48000, 0)).toBeCloseTo(100 - 0.044, 9);
    expect(correctOffset(100, 0, 2112 / 48000)).toBeCloseTo(100 + 0.044, 9);
  });
});

/** A caption line with one word every half second from `start`. */
function line(text: string, start: number): CaptionLine {
  const words = text.split(" ").map((_, i) => ({ start: start + i * 0.5, end: start + i * 0.5 + 0.4 }));
  return { text, words };
}

/** The (start, end, text) of each SRT cue. */
function cues(srt: string) {
  return srt
    .trim()
    .split(/\n\n/)
    .map((block) => {
      const [n, times, ...text] = block.split("\n");
      const [start, end] = times.split(" --> ");
      return { n, start, end, text: text.join("\n") };
    });
}

describe("captionsSrt", () => {
  it("shows each line from its first word until the next line starts", () => {
    const c = cues(captionsSrt([line("one two three", 5), line("four five", 6.8)]));
    expect(c[0]).toEqual({ n: "1", start: "00:00:05,000", end: "00:00:06,800", text: "one two three" });
    expect(c[1].start).toBe("00:00:06,800");
  });

  it("clears a line a second after its last word when the next is a long way off", () => {
    const c = cues(captionsSrt([line("one two", 5), line("three", 40)]));
    expect(c[0].end).toBe("00:00:06,900");
  });

  it("clears the last line a second after its last word", () => {
    const c = cues(captionsSrt([line("one two", 3661)]));
    expect(c[0]).toMatchObject({ start: "01:01:01,000", end: "01:01:02,900" });
  });

  it("breaks a line longer than 42 characters at a word, within the same caption", () => {
    const text = "aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj";
    const c = cues(captionsSrt([line(text, 1)]));
    expect(c).toHaveLength(1);
    expect(c[0].text).toBe("aaaa bbbb cccc dddd eeee ffff gggg hhhh\niiii jjjj");
  });

  it("leaves out a line no word was aligned to", () => {
    const c = cues(captionsSrt([line("one", 1), { text: "lost", words: [] }, line("two", 4)]));
    expect(c.map((x) => x.text)).toEqual(["one", "two"]);
    expect(c.map((x) => x.n)).toEqual(["1", "2"]);
  });
});

describe("strandedWords", () => {
  it("flags a word more than 4 seconds from the word before it in its line", () => {
    const early = { text: "a b c", words: [{ start: 1, end: 1.2 }, { start: 30, end: 30.4 }, { start: 30.5, end: 30.9 }] };
    const late = { text: "d e", words: [{ start: 40, end: 40.4 }, { start: 52, end: 52.4 }] };
    expect(strandedWords([early, late])).toEqual([
      { line: 1, word: 2, gap: 28.8, from: 1.2, to: 30 },
      { line: 2, word: 2, gap: 11.6, from: 40.4, to: 52 },
    ]);
  });

  it("flags nothing in lines whose words are close together", () => {
    expect(strandedWords([line("one two three", 5), line("four", 40)])).toEqual([]);
  });
});

describe("encoderDelay", () => {
  it("reads a file's encoder delay in seconds, as padding over sample rate", () => {
    // ffmpeg's AAC encoder primes 1024 samples; at 48 kHz that's 21.3 ms.
    const dir = mkdtempSync(join(tmpdir(), "delay-"));
    const file = join(dir, "tone.m4a");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1:sample_rate=48000", "-c:a", "aac", file]);
    expect(encoderDelay(file)).toBeCloseTo(1024 / 48000, 6);
    rmSync(dir, { recursive: true, force: true });
  });
});
