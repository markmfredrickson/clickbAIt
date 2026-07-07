import { describe, it, expect } from "vitest";
import { SongManifestSchema, type SongManifest } from "../src/manifest.js";
import type { AlignInput } from "../src/build/lyrics-timing.js";
import { buildLyricsDisplay, alignWords } from "../src/build/lyrics-display.js";
import { Curve } from "../src/core/curve.js";

// --- fixtures --------------------------------------------------------------

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

/**
 * A valid manifest with overridable parts. The default recording beat-map pins
 * song beats 0 and 1 at 0s and 0.5s; at 120 BPM the curve extrapolates at the
 * same 2 beats/sec, so `beat = 2 · seconds` everywhere (the old anchor {t:0,b:0}
 * 120-BPM case).
 */
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
        beatMap: [{ startBeat: 0, times: [0, 0.5] }],
      },
    },
    songCurve: "constantBpm",
    sections: [],
    lyrics: {},
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
    const align = mkAlign([["WHEN", 1000, 1100], ["THE", 1200, 1300], ["SAINTS", 1500, 1800]]);
    const out = buildLyricsDisplay(mkManifest(), align);

    expect(out.schema).toBe("clickbait/lyrics-display@1");
    expect(out.words.map((w) => w.text)).toEqual(["WHEN", "THE", "SAINTS"]);
    expect(out.words[0].startBeat).toBeCloseTo(2.0); // 1.0s * 2 beats/sec
    expect(out.words[2].startBeat).toBeCloseTo(3.0); // 1.5s
    // beat-only: no seconds fields leak in
    expect(out.words[0]).not.toHaveProperty("startT");
    expect(out.words[0]).not.toHaveProperty("startSeconds");
  });

  // #2 curves wired right: the beat-map offset shifts the musical beat
  it("applies the recording beat-map offset to word beats", () => {
    // Pin song beat -2 at 0s (i.e. the downbeat is 1.0s in) => beat = 2·t - 2.
    const m = mkManifest({
      sources: {
        recording: {
          kind: "audio",
          file: "source.m4a",
          beatMap: [{ startBeat: -2, times: [0, 0.5] }],
        },
      },
    });
    // word at 2.0s => musical beat 2·2 - 2 = 2
    const align = mkAlign([["X", 2000, 2050]]);
    const out = buildLyricsDisplay(m, align);
    expect(out.words[0].startBeat).toBeCloseTo(2.0);
  });

  // #3 line slicing by align-normalized word count, not whitespace
  it("slices authored lines into word ranges by normalized word count", () => {
    // 9 aligned words
    const align = mkAlign(
      ["GO A MARCHIN IN WHEN THE SAINTS GO IN".split(" ").map((t, i) => [t, 1000 + i * 200, 1100 + i * 200] as [string, number, number])][0],
    );
    const m = mkManifest({
      sections: [
        { name: "Verse 1", bars: 8, lines: [
          { text: "go a-marchin' in" }, // 4 normalized words (hyphen splits)
          { text: "when the saints go in" }, // 5 normalized words
        ] },
      ],
    });
    const out = buildLyricsDisplay(m, align);
    expect(out.display.lines).toHaveLength(2);
    expect(out.display.lines[0].words).toEqual([0, 3]); // 4 words: indices 0..3
    expect(out.display.lines[1].words).toEqual([4, 8]); // 5 words: indices 4..8
    expect(out.display.lines[0].section).toBe("Verse 1");
  });

  // #4 sections copied as display labels
  it("copies manifest sections to display.sections", () => {
    const align = mkAlign([["A", 1000, 1100]]);
    const m = mkManifest({
      sections: [
        { name: "Chorus 1", bars: 16, cue: true },
        { name: "Instrumental", bars: 20 },
      ],
    });
    const out = buildLyricsDisplay(m, align);
    expect(out.display.sections).toEqual([
      { name: "Chorus 1", startBeat: 0, cue: true },
      { name: "Instrumental", startBeat: 64 },
    ]);
  });

  // #5 explicit section membership — a pickup groups under its section even
  // though its measured beat lands before the section's start beat.
  it("uses the containing section, so a pickup groups under its section", () => {
    // "PICKUP" sung at 30s => beat 60, which is BEFORE Verse 1's beat (64).
    const align = mkAlign([["EARLY", 1000, 1100], ["PICKUP", 30000, 30100]]);
    const m = mkManifest({
      sections: [
        { name: "Intro", bars: 16, lines: [{ text: "early" }] },
        { name: "Verse 1", bars: 16, lines: [{ text: "pickup" }] },
      ],
    });
    const out = buildLyricsDisplay(m, align);
    expect(out.display.lines[0].section).toBe("Intro");
    // pickup beat 60 < Verse 1's 64, yet it's grouped under Verse 1 by authorship
    expect(out.words[out.display.lines[1].words[0]].startBeat).toBeCloseTo(60);
    expect(out.display.lines[1].section).toBe("Verse 1");
  });

  // pre-roll: downbeat sits at the pre-roll offset; count-in is negative beats
  // at positive time; word beats (downbeat-relative) are unchanged.
  it("places the downbeat at the pre-roll offset, count-in at negative beats", () => {
    const align = mkAlign([["A", 1000, 1100]]); // word at 1.0s => beat 2
    const m = mkManifest({ bpm: 120, timeSignature: [4, 4], preRollBars: 2 });
    const out = buildLyricsDisplay(m, align);

    const c = new Curve(out.curve);
    // 2 bars @ 120 BPM 4/4 = 8 beats = 4s pre-roll.
    expect(c.toTime(0)).toBeCloseTo(4); // downbeat at song-time 4s
    expect(c.toBeat(0)).toBeCloseTo(-8); // time 0 is beat -8 (count-in start)
    // The word beat is downbeat-relative and unaffected by the pre-roll.
    expect(out.words[0].startBeat).toBeCloseTo(2);
  });

  // #6 curve anchors carried for the client's beat<->seconds
  it("carries the song curve anchors", () => {
    const out = buildLyricsDisplay(mkManifest({ bpm: 120 }), mkAlign([["A", 0, 100]]));
    // constant 120 BPM => 2 anchors, slope 2 beats/sec
    expect(out.curve.length).toBeGreaterThanOrEqual(2);
    const [a0, a1] = out.curve;
    const bps = (a1.b - a0.b) / (a1.t - a0.t);
    expect(bps).toBeCloseTo(2.0);
  });

  // #7 end to end: well-formed, tags carried
  it("produces a well-formed display end to end", () => {
    const align = mkAlign(
      "WHEN THE SAINTS GO MARCHIN IN".split(" ").map((t, i) => [t, 1000 + i * 300, 1200 + i * 300] as [string, number, number]),
    );
    const m = mkManifest({
      title: "When the Saints Go Marching In",
      artist: "Louis Armstrong",
      sections: [{ name: "Chorus 1", bars: 16, cue: true, lines: [
        { text: "when the saints", tag: "Lead" },
        { text: "go marchin' in", tag: "Response" },
      ] }],
    });
    const out = buildLyricsDisplay(m, align);
    expect(out.title).toBe("When the Saints Go Marching In");
    expect(out.artist).toBe("Louis Armstrong");
    expect(out.slug).toContain("saints");
    expect(out.words).toHaveLength(6);
    expect(out.display.lines[0].tag).toBe("Lead");
    expect(out.display.lines[1].tag).toBe("Response");
    expect(out.display.lines[1].words).toEqual([3, 5]);
  });
});
