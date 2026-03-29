import { song, seq, span, bars, cue, lyric, chord } from "../../src/dsongl.js";

/**
 * When the Saints Go Marching In — Traditional
 *
 * BPM: 116
 * Key: G major
 * Time signature: 4/4
 *
 * Traditional African-American spiritual / hymn, public domain (pre-1927).
 * Standard 5-verse arrangement. Each verse is 16 bars (4 lines × 4 bars).
 * Chord progression repeats each verse:
 *   Line 1: G (4 bars)
 *   Line 2: G - G7 - C (4 bars)
 *   Line 3: G - B7 - Em (4 bars)
 *   Line 4: G - D7 - G (4 bars)
 */

export default song("When the Saints Go Marching In", 116, { artist: "Traditional", key: "G" },
  seq(
    // ── Intro (2 bars) — count-in ──
    span("Intro", bars(2), [
      chord("G", 0),
    ]),

    // ── Verse 1 ──
    span("Verse 1", bars(16), [
      cue("Verse", -8),
      // Line 1: "Oh when the saints go marching in"
      chord("G", 0),
      lyric("Oh when the saints go marching in", 0, "Lead Vocal"),
      // Line 2: "Oh when the saints go marching in"
      chord("G", 16),
      lyric("Oh when the saints go marching in", 16, "Lead Vocal"),
      chord("G7", 24),
      chord("C", 28),
      // Line 3: "Oh Lord I want to be in that number"
      chord("G", 32),
      lyric("Oh Lord I want to be in that number", 32, "Lead Vocal"),
      chord("B7", 40),
      chord("Em", 44),
      // Line 4: "When the saints go marching in"
      chord("G", 48),
      lyric("When the saints go marching in", 48, "Lead Vocal"),
      chord("D7", 52),
      chord("G", 56),
    ]),

    // ── Verse 2 ──
    span("Verse 2", bars(16), [
      cue("Verse", -8),
      chord("G", 0),
      lyric("Oh when the sun refuse to shine", 0, "Lead Vocal"),
      chord("G", 16),
      lyric("Oh when the sun refuse to shine", 16, "Lead Vocal"),
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
    span("Verse 3", bars(16), [
      cue("Verse", -8),
      chord("G", 0),
      lyric("Oh when the trumpet sounds its call", 0, "Lead Vocal"),
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

    // ── Verse 4 ──
    span("Verse 4", bars(16), [
      cue("Verse", -8),
      chord("G", 0),
      lyric("Oh when the stars have disappeared", 0, "Lead Vocal"),
      chord("G", 16),
      lyric("Oh when the stars have disappeared", 16, "Lead Vocal"),
      chord("G7", 24),
      chord("C", 28),
      chord("G", 32),
      lyric("Oh Lord I want to be in that number", 32, "Lead Vocal"),
      chord("B7", 40),
      chord("Em", 44),
      chord("G", 48),
      lyric("When the stars have disappeared", 48, "Lead Vocal"),
      chord("D7", 52),
      chord("G", 56),
    ]),

    // ── Verse 5 ──
    span("Verse 5", bars(16), [
      cue("Verse", -8),
      chord("G", 0),
      lyric("Oh on that hallelujah day", 0, "Lead Vocal"),
      chord("G", 16),
      lyric("Oh on that hallelujah day", 16, "Lead Vocal"),
      chord("G7", 24),
      chord("C", 28),
      chord("G", 32),
      lyric("Oh Lord I want to be in that number", 32, "Lead Vocal"),
      chord("B7", 40),
      chord("Em", 44),
      chord("G", 48),
      lyric("On that hallelujah day", 48, "Lead Vocal"),
      chord("D7", 52),
      chord("G", 56),
    ]),
  ),
);
