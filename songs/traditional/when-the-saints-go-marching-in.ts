import { song, seq, span, bars, lyric, chord, audio } from "../../src/dsongl.js";

/**
 * When the Saints Go Marching In — Traditional
 *
 * BPM: 129
 * Key: G major
 * Time signature: 4/4
 *
 * Based on a pre-1927 78rpm recording (tests/fixtures/audio/saints-78rpm.mp3).
 * Recording structure:
 *   0–5s:   silence/surface noise
 *   5–18s:  spoken intro (announcer)
 *   18–40s: instrumental (band, no vocals)
 *   40s+:   vocal verses with call-and-response
 *
 * Audio placed with soffs=18 to skip the spoken intro.
 * The instrumental section becomes the Intro in the project.
 */

export default song("When the Saints Go Marching In", 129, { artist: "Traditional", key: "G" },
  seq(
    // ── Intro (4 bars) — title cue + count-in (before the audio starts) ──
    span("Intro", bars(4), [
      chord("G", 0),
    ]),

    // ── Instrumental (12 bars) — band plays, no vocals (~18s–40s in recording) ──
    span("Instrumental", bars(12), { cue: true }, [
      chord("G", 0),
      audio("78rpm Recording", "tests/fixtures/audio/saints-78rpm.mp3", { soffs: 18 }),
    ]),

    // ── Verse 1 — call and response vocals begin (~40s in recording) ──
    span("Verse 1", bars(16), { cue: true }, [
      chord("G", 0),
      lyric("Oh when the saints go marching in", 0, "Lead Vocal"),
      lyric("When the saints!", 4, "Response"),
      chord("G", 16),
      lyric("Oh when the saints go marching in", 16, "Lead Vocal"),
      lyric("Go marching in!", 20, "Response"),
      chord("G7", 24),
      chord("C", 28),
      chord("G", 32),
      lyric("Oh Lord I want to be in that number", 32, "Lead Vocal"),
      chord("B7", 40),
      chord("Em", 44),
      chord("G", 48),
      lyric("When the saints go marching in", 48, "Lead Vocal"),
      chord("D7", 52),
      chord("G", 56),
    ]),

    // ── Verse 2 ──
    span("Verse 2", bars(16), { cue: true }, [
      chord("G", 0),
      lyric("Oh when the sun refuse to shine", 0, "Lead Vocal"),
      lyric("When the sun!", 4, "Response"),
      chord("G", 16),
      lyric("Oh when the sun refuse to shine", 16, "Lead Vocal"),
      lyric("Refuse to shine!", 20, "Response"),
      chord("G7", 24),
      chord("C", 28),
      chord("G", 32),
      lyric("Oh Lord I want to be in that number", 32, "Lead Vocal"),
      chord("B7", 40),
      chord("Em", 44),
      chord("G", 48),
      lyric("When the sun refuse to shine", 48, "Lead Vocal"),
      chord("D7", 52),
      chord("G", 56),
    ]),

    // ── Verse 3 ──
    span("Verse 3", bars(16), { cue: true }, [
      chord("G", 0),
      lyric("Oh when the trumpet sounds its call", 0, "Lead Vocal"),
      lyric("Sounds its call!", 4, "Response"),
      chord("G", 16),
      lyric("Oh when the trumpet sounds its call", 16, "Lead Vocal"),
      chord("G7", 24),
      chord("C", 28),
      chord("G", 32),
      lyric("Oh Lord I want to be in that number", 32, "Lead Vocal"),
      chord("B7", 40),
      chord("Em", 44),
      chord("G", 48),
      lyric("When the trumpet sounds its call", 48, "Lead Vocal"),
      chord("D7", 52),
      chord("G", 56),
    ]),
  ),
);
