import { describe, it, expect } from "vitest";
import { exportSongPayload } from "../../src/teleprompter/export.js";
import { song, seq, span, bars, lyric, chord, cue } from "../../src/dsongl.js";

const testSong = song("Test Song", 120, { artist: "Test Artist", key: "C" },
  seq(
    span("Intro", bars(2), [
      chord("C", 0),
      chord("G", 4),
    ]),
    span("Verse 1", bars(4), [
      cue("Verse", -4),
      chord("C", 0),
      lyric("Hello world", 0, "Lead Vocal"),
      chord("Am", 4),
      lyric("Second line", 4, "Lead Vocal"),
      chord("F", 8),
      lyric("Third line", 8, "Lead Vocal"),
      chord("G", 12),
      lyric("Fourth line", 12, "Lead Vocal"),
    ]),
    span("Chorus", bars(4), [
      cue("Chorus", -4),
      chord("F", 0),
      lyric("Chorus line one", 0, "Lead Vocal"),
      chord("G", 4),
      lyric("Chorus line two", 4, "Lead Vocal"),
      chord("C", 8),
      lyric("Chorus line three", 8, "Lead Vocal"),
      chord("C", 12),
    ]),
  ),
);

describe("exportSongPayload", () => {
  const payload = exportSongPayload(testSong);

  it("includes song metadata", () => {
    expect(payload.title).toBe("Test Song");
    expect(payload.artist).toBe("Test Artist");
    expect(payload.key).toBe("C");
    expect(payload.bpm).toBe(120);
  });

  it("extracts all sections", () => {
    expect(payload.sections).toHaveLength(3);
    expect(payload.sections.map((s) => s.name)).toEqual([
      "Intro", "Verse 1", "Chorus",
    ]);
  });

  it("assigns correct beat positions to sections", () => {
    // 4/4 time, Intro=2 bars=8 beats, Verse=4 bars=16 beats
    expect(payload.sections[0].beat).toBe(0);
    expect(payload.sections[1].beat).toBe(8);
    expect(payload.sections[2].beat).toBe(24);
  });

  it("computes section durations", () => {
    expect(payload.sections[0].durationBeats).toBe(8);  // 2 bars * 4
    expect(payload.sections[1].durationBeats).toBe(16); // 4 bars * 4
    expect(payload.sections[2].durationBeats).toBe(16); // 4 bars * 4
  });

  it("computes section seconds from BPM", () => {
    // 120 BPM = 2 beats/sec = 0.5 sec/beat
    expect(payload.sections[0].seconds).toBeCloseTo(0);
    expect(payload.sections[1].seconds).toBeCloseTo(4);   // 8 beats * 0.5
    expect(payload.sections[2].seconds).toBeCloseTo(12);  // 24 beats * 0.5
  });

  it("computes section duration in seconds", () => {
    // 120 BPM: 8 beats = 4 sec, 16 beats = 8 sec
    expect(payload.sections[0].durationSeconds).toBeCloseTo(4);
    expect(payload.sections[1].durationSeconds).toBeCloseTo(8);
    expect(payload.sections[2].durationSeconds).toBeCloseTo(8);
  });

  it("groups lyrics into correct sections", () => {
    expect(payload.sections[0].lyrics).toHaveLength(0); // Intro has no lyrics
    expect(payload.sections[1].lyrics).toHaveLength(4);
    expect(payload.sections[1].lyrics[0].text).toBe("Hello world");
    expect(payload.sections[2].lyrics).toHaveLength(3);
    expect(payload.sections[2].lyrics[0].text).toBe("Chorus line one");
  });

  it("groups chords into correct sections", () => {
    expect(payload.sections[0].chords).toHaveLength(2); // C, G
    expect(payload.sections[1].chords).toHaveLength(4); // C, Am, F, G
    expect(payload.sections[2].chords).toHaveLength(4); // F, G, C, C
  });

  it("includes timing on lyric lines", () => {
    const firstLyric = payload.sections[1].lyrics[0];
    expect(firstLyric.beat).toBe(8); // Verse starts at beat 8
    expect(firstLyric.seconds).toBeCloseTo(4); // 8 beats at 120 BPM
    expect(firstLyric.tag).toBe("Lead Vocal");
  });

  it("includes timing on chord marks", () => {
    const firstChord = payload.sections[1].chords[0];
    expect(firstChord.chord).toBe("C");
    expect(firstChord.beat).toBe(8);
    expect(firstChord.seconds).toBeCloseTo(4);
  });
});
