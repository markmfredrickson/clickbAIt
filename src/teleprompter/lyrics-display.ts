/**
 * The built lyrics display — the file the teleprompter reads to show lyrics in
 * time with the song.
 *
 * Lyrics are one time-synced display; later there will be siblings (chords, or
 * other notes for musicians). They'll likely share the grouping and curve ideas
 * here, so the line/section/curve parts are named for display in general, while
 * the word is specific to lyrics.
 *
 * The builder writes this from a `.song.json` manifest plus the alignment; the
 * teleprompter client reads it. Both import these types so the shape stays in
 * sync between them.
 *
 * Three choices behind the shape:
 *
 * 1. Words now, letters later. Timing is stored per word. The alignment also
 *    measures individual letters, but we keep them out for now — the first
 *    display highlights whole words. The letter times stay in `align.json`, and
 *    this file is rebuilt from it, so a later within-word sweep just means
 *    rebuilding and adding letters. Nothing is lost by waiting.
 *
 * 2. The text people read is the real text. A word's `text` is the actual
 *    lyric with its punctuation and capitalization ("fight,"). The aligner
 *    strips those, but the timing only needs the word's start and end, so the
 *    display text and the timing live together with no conflict.
 *
 * 3. Beats, not seconds. Beat is the coordinate that doesn't move when tempo
 *    does. The `curve` anchors let a client turn beats into seconds when it
 *    needs to (the standalone bundle player plays by audio time). Raw measured
 *    seconds stay in `align.json`.
 *
 * Timing lives on the words; lines and sections only group them, so re-lining
 * or re-grouping never disturbs the timing.
 */

import type { Anchor } from "../curve.js";

/** A sung word: its span in beats, and the real text to show (with punctuation). */
export interface LyricWord {
  text: string;
  startBeat: number;
  endBeat: number;
}

/**
 * A display line. Points at a span of `words` by index; it does not copy them
 * and has no timing of its own.
 */
export interface DisplayLine {
  /** [start, end] inclusive indices into the song's `words` list. */
  words: [number, number];
  /** e.g. "Lead Vocal", "Backing Vocal". */
  tag?: string;
  /** Name of the section this line belongs to. */
  section?: string;
}

/** A section label with a start beat. For navigation and cues, not a container. */
export interface DisplaySection {
  name: string;
  startBeat: number;
  cue?: boolean;
}

/**
 * One stretch of constant meter, in REAPER measure order. Lets a client turn
 * REAPER's `measure.beat` OSC string into a continuous beat when the meter
 * isn't constant (e.g. a 2/4 pickup bar) — multiplying measures by a fixed
 * beats-per-bar overcounts by 2 for every short bar before the cursor.
 */
export interface MeterSegment {
  /** First REAPER measure this segment covers (1-based; downbeat = measure 1). */
  fromMeasure: number;
  beatsPerBar: number;
  /** Cumulative continuous beats before this segment's first measure. */
  beatsBefore: number;
}

/** The whole built lyrics display. */
export interface LyricsDisplay {
  schema: "clickbait/lyrics-display@1";
  title: string;
  artist?: string;
  key?: string;
  bpm: number;
  /** [beats-per-bar, beat-unit]. Lets a client turn REAPER's measure.beat OSC
   *  string into a continuous beat. */
  timeSignature: [number, number];
  /** Slug for file lookup and RPP region identification. */
  slug: string;
  /** Song curve anchors (constant tempo => two). Lets a client convert beats to seconds. */
  curve: Anchor[];

  /** Meter segments in REAPER measure order. Present when the song has a meter
   *  change (e.g. a 2/4 pickup); a single-meter song can omit it and the client
   *  falls back to `timeSignature[0]` beats per bar. */
  meterMap?: MeterSegment[];

  /** The timeline: every sung word in order. Timing lives here. */
  words: LyricWord[];

  /** How to group the words on screen. Editing this never moves the timing. */
  display: {
    sections: DisplaySection[];
    lines: DisplayLine[];
  };
}
