import { describe, it, expect } from "vitest";
import { SongManifestSchema, type SongManifest } from "../src/manifest.js";
import type { AlignInput } from "../src/lyrics-timing.js";
import { buildLyricsDisplay, alignWords } from "../src/build-lyrics-display.js";

// --- fixtures --------------------------------------------------------------

/** A constant-spacing detected-beat grid. spacing 0.5s = 120 BPM. */
function mkBeats(n: number, spacing = 0.5, t0 = 0): { time: number }[] {
  return Array.from({ length: n }, (_, i) => ({ time: t0 + i * spacing }));
}

/** Align input from [text, startMs, endMs] triples (one char per word, enough for the bridge). */
function mkAlign(words: [string, number, number][]): AlignInput {
  return {
    words: words.map(([text, s, e]) => ({
      text,
      startMs: s,
      endMs: e,
      chars: [{ text: text[0] ?? "x", startMs: s, endMs: e }],
    })),
  };
}

/** A valid manifest with overridable parts. */
function mkManifest(over: Record<string, unknown> = {}): SongManifest {
  return SongManifestSchema.parse({
    schema: "clickbait/song@1",
    title: "Test Song",
    artist: "Tester",
    bpm: 120,
    timeSignature: [4, 4],
    sources: {
      recording: {
        kind: "audio",
        file: "source.m4a",
        beats: { file: "source.beats.json", "produced-by": "clickbait-audio beats" },
        anchor: { t: 0, b: 0 },
      },
    },
    songCurve: "constantBpm",
    sections: [],
    lyrics: {
      text: { file: "x.lyrics.txt", "produced-by": "human" },
      lines: [],
    },
    ...over,
  });
}

// --- tokenizer (gates the line slicing) ------------------------------------

describe("alignWords", () => {
  it("splits the way the aligner normalizes — letters + apostrophe, else a break", () => {
    // hyphen splits; apostrophe stays inside the word
    expect(alignWords("go a-marchin' in")).toEqual(["go", "a", "marchin'", "in"]);
    expect(alignWords("Oh, to be in that number, number yeah")).toHaveLength(8);
    expect(alignWords("They're gonna get together there")).toEqual([
      "they're", "gonna", "get", "together", "there",
    ]);
  });
});

// --- builder ----------------------------------------------------------------

describe("buildLyricsDisplay", () => {
  // #1 words: beats kept, seconds dropped, order preserved, schema set
  it("turns aligned words into beat-only LyricWords in order", () => {
    const beats = mkBeats(20); // 120 BPM, anchor {t:0,b:0} => musical beat = 2 * seconds
    const align = mkAlign([["WHEN", 1000, 1100], ["THE", 1200, 1300], ["SAINTS", 1500, 1800]]);
    const out = buildLyricsDisplay(mkManifest(), align, beats);

    expect(out.schema).toBe("clickbait/lyrics-display@1");
    expect(out.words.map((w) => w.text)).toEqual(["WHEN", "THE", "SAINTS"]);
    expect(out.words[0].startBeat).toBeCloseTo(2.0); // 1.0s * 2 beats/sec
    expect(out.words[2].startBeat).toBeCloseTo(3.0); // 1.5s
    // beat-only: no seconds fields leak in
    expect(out.words[0]).not.toHaveProperty("startT");
    expect(out.words[0]).not.toHaveProperty("startSeconds");
  });

  // #2 curves wired right: the bar-1 anchor offsets the musical beat
  it("applies the recording bar-1 anchor to word beats", () => {
    const beats = mkBeats(20); // detected beat i at 0.5*i s
    // declare detected beat 2 is musical beat 0 => offset -2
    const m = mkManifest({
      sources: {
        recording: {
          kind: "audio",
          file: "source.m4a",
          beats: { file: "b.json", "produced-by": "x" },
          anchor: { t: 1.0, b: 0 }, // 1.0s == beats[2].time
        },
      },
    });
    // word at 2.0s => detected beat 4 => musical beat 4 - 2 = 2
    const align = mkAlign([["X", 2000, 2050]]);
    const out = buildLyricsDisplay(m, align, beats);
    expect(out.words[0].startBeat).toBeCloseTo(2.0);
  });

  // #3 line slicing by align-normalized word count, not whitespace
  it("slices authored lines into word ranges by normalized word count", () => {
    const beats = mkBeats(40);
    // 9 aligned words
    const align = mkAlign(
      ["GO A MARCHIN IN WHEN THE SAINTS GO IN".split(" ").map((t, i) => [t, 1000 + i * 200, 1100 + i * 200] as [string, number, number])][0],
    );
    const m = mkManifest({
      lyrics: {
        text: { file: "x.txt", "produced-by": "human" },
        lines: [
          { text: "go a-marchin' in" }, // 4 normalized words (hyphen splits)
          { text: "when the saints go in" }, // 5 normalized words
        ],
      },
    });
    const out = buildLyricsDisplay(m, align, beats);
    expect(out.display.lines).toHaveLength(2);
    expect(out.display.lines[0].words).toEqual([0, 3]); // 4 words: indices 0..3
    expect(out.display.lines[1].words).toEqual([4, 8]); // 5 words: indices 4..8
  });

  // #4 sections copied as display labels
  it("copies manifest sections to display.sections", () => {
    const beats = mkBeats(20);
    const align = mkAlign([["A", 1000, 1100]]);
    const m = mkManifest({
      sections: [
        { name: "Chorus 1", b: 0, bars: 16, cue: true },
        { name: "Instrumental", b: 64, bars: 20 },
      ],
    });
    const out = buildLyricsDisplay(m, align, beats);
    expect(out.display.sections).toEqual([
      { name: "Chorus 1", startBeat: 0, cue: true },
      { name: "Instrumental", startBeat: 64 },
    ]);
  });

  // #5 line -> section: last section starting at or before the line's first word
  it("attributes each line to the section it starts in", () => {
    const beats = mkBeats(200);
    // two words: first at 1.0s (beat 2), second at 40.0s (beat 80)
    const align = mkAlign([["EARLY", 1000, 1100], ["LATE", 40000, 40100]]);
    const m = mkManifest({
      sections: [
        { name: "Chorus 1", b: 0, bars: 16 },
        { name: "Instrumental", b: 64, bars: 20 },
      ],
      lyrics: {
        text: { file: "x.txt", "produced-by": "human" },
        lines: [{ text: "early" }, { text: "late" }],
      },
    });
    const out = buildLyricsDisplay(m, align, beats);
    expect(out.display.lines[0].section).toBe("Chorus 1"); // beat 2
    expect(out.display.lines[1].section).toBe("Instrumental"); // beat 80 >= 64
  });

  // #6 curve anchors carried for the client's beat<->seconds
  it("carries the song curve anchors", () => {
    const out = buildLyricsDisplay(mkManifest({ bpm: 120 }), mkAlign([["A", 0, 100]]), mkBeats(20));
    // constant 120 BPM => 2 anchors, slope 2 beats/sec
    expect(out.curve.length).toBeGreaterThanOrEqual(2);
    const [a0, a1] = out.curve;
    const bps = (a1.b - a0.b) / (a1.t - a0.t);
    expect(bps).toBeCloseTo(2.0);
  });

  // #7 end to end: well-formed, tags carried
  it("produces a well-formed display end to end", () => {
    const beats = mkBeats(40);
    const align = mkAlign(
      "WHEN THE SAINTS GO MARCHIN IN".split(" ").map((t, i) => [t, 1000 + i * 300, 1200 + i * 300] as [string, number, number]),
    );
    const m = mkManifest({
      title: "When the Saints Go Marching In",
      artist: "Louis Armstrong",
      sections: [{ name: "Chorus 1", b: 0, bars: 16, cue: true }],
      lyrics: {
        text: { file: "x.txt", "produced-by": "human" },
        lines: [
          { text: "when the saints", tag: "Lead" },
          { text: "go marchin' in", tag: "Response" },
        ],
      },
    });
    const out = buildLyricsDisplay(m, align, beats);
    expect(out.title).toBe("When the Saints Go Marching In");
    expect(out.artist).toBe("Louis Armstrong");
    expect(out.slug).toContain("saints");
    expect(out.words).toHaveLength(6);
    expect(out.display.lines[0].tag).toBe("Lead");
    expect(out.display.lines[1].tag).toBe("Response");
    expect(out.display.lines[1].words).toEqual([3, 5]);
  });
});
