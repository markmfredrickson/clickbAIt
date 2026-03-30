import { song, seq, span, bars, cue, lyric, chord } from "@clickbait/dsongl";

/**
 * When the Saints Go Marching In — Traditional
 *
 * BPM: 116
 * Key: G major
 * Time signature: 4/4
 *
 * Public domain hymn / spiritual, pre-1927.
 * Standard 4-verse arrangement with 16 bars per verse.
 * Chord progression: 4 bars per lyric line, 4 lines per verse.
 *
 * Used as a test track for the teleprompter — known ground truth
 * with no audio source (lyrics placed by section/phrase).
 */

export default song("When the Saints Go Marching In", 116, { artist: "Traditional", key: "G" },
  seq(
    // ── Intro (2 bars) — count-in only ──
    span("Intro", bars(2), [
      chord("G", 0),
    ]),

    // ── Verse 1 ──
    span("Verse 1", bars(16), [
      cue("Verse", -8),
      // Line 1: "Oh, when the saints go marching in"
      chord("G", 0),
      lyric("Oh, when the saints go marching in", 0, "Lead Vocal"),
      // Line 2: "Oh, when the saints go marching in"
      chord("G", 8),
      lyric("Oh, when the saints go marching in", 16, "Lead Vocal"),
      // Line 3: "Oh Lord, I want to be in that number"
      chord("G", 32),
      lyric("Oh Lord, I want to be in that number", 32, "Lead Vocal"),
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
      lyric("Oh, when the sun refuse to shine", 0, "Lead Vocal"),
      chord("G7", 12),
      chord("C", 16),
      lyric("Oh, when the sun refuse to shine", 16, "Lead Vocal"),
      chord("G", 32),
      lyric("Oh Lord, I want to be in that number", 32, "Lead Vocal"),
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
      lyric("Oh, when the trumpet sounds its call", 0, "Lead Vocal"),
      chord("G7", 12),
      chord("C", 16),
      lyric("Oh, when the trumpet sounds its call", 16, "Lead Vocal"),
      chord("G", 32),
      lyric("Oh Lord, I want to be in that number", 32, "Lead Vocal"),
      chord("B7", 40),
      chord("Em", 44),
      chord("G", 48),
      lyric("When the trumpet sounds its call", 48, "Lead Vocal"),
      chord("D7", 52),
      chord("G", 56),
    ]),

    // ── Verse 4 (reprise) ──
    span("Verse 4", bars(16), [
      cue("Verse", -8),
      chord("G", 0),
      lyric("Oh, when the saints go marching in", 0, "Lead Vocal"),
      chord("G7", 12),
      chord("C", 16),
      lyric("Oh, when the saints go marching in", 16, "Lead Vocal"),
      chord("G", 32),
      lyric("Oh Lord, I want to be in that number", 32, "Lead Vocal"),
      chord("B7", 40),
      chord("Em", 44),
      chord("G", 48),
      lyric("When the saints go marching in", 48, "Lead Vocal"),
      chord("D7", 52),
      chord("G", 56),
    ]),
  ),
);
