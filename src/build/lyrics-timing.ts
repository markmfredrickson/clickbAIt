/**
 * Lyric timing bridge — measured alignment → song timing.
 *
 * `clickbait-audio align` measures, for each character of the lyrics, the
 * millisecond it was sung in the RECORDING. Those measured seconds are the
 * ground truth (see docs/song-schema-migration.md: alignment is primary).
 * To place a word on the song's beat grid we route it through two curves that
 * share the musical-beat axis:
 *
 *     measured recording seconds
 *        │  recordingCurve.toBeat       (recording time → musical beat)
 *        ▼
 *     musical beat
 *        │  songCurve.toTime            (musical beat → song grid time)
 *        ▼
 *     song time
 *
 * The ONE thing this cannot derive is where bar 1 sits in the recording — the
 * recording almost never starts on the downbeat. That offset is a single
 * manual anchor per song (`recording.anchor` in the manifest). Because every
 * beat/time here is RE-DERIVED from (measured seconds + anchor) at build time,
 * fixing a wrong bar-1 is a one-number edit + rebuild — no re-running align.
 */

import { Curve } from "../core/curve.js";

/** A character as emitted by `clickbait-audio align` (recording-time ms). */
export interface AlignChar {
  text: string;
  startMs: number;
  endMs: number;
}

/** A word as emitted by `clickbait-audio align` (recording-time ms). */
export interface AlignWord {
  text: string;
  startMs: number;
  endMs: number;
  chars: AlignChar[];
}

/** The subset of `align.json` this bridge consumes. */
export interface AlignInput {
  words: AlignWord[];
}

/** A timed unit in SONG coordinates: both axes resolved (co-equal). */
export interface TimedSpan {
  text: string;
  /** Musical beat at start / end. */
  startB: number;
  endB: number;
  /** Song grid time (seconds) at start / end. */
  startT: number;
  endT: number;
}

export interface TimedToken extends TimedSpan {
  chars: TimedSpan[];
}

/** A recording-time anchor: "recording time `t` is musical beat `b`." */
export interface RecordingAnchor {
  t: number;
  b: number;
}

/**
 * Build the recording curve (recording time ↔ musical beat) from detected
 * beats plus a single anchor.
 *
 * The detected beats arrive as bare times with no musical meaning — index 0 is
 * just the first beat the tracker found, not bar 1. The anchor fixes that:
 * whatever musical beat the caller declares for `anchor.t` shifts the whole
 * numbering. We measure the fractional detected-beat index at the anchor time,
 * then renumber every beat by the constant offset that makes it line up.
 */
export function recordingCurveFromBeats(
  beats: readonly { time: number }[],
  anchor: RecordingAnchor,
): Curve {
  if (beats.length < 2) {
    throw new Error("recordingCurveFromBeats needs at least two detected beats");
  }
  // Raw curve: detected-beat INDEX as the (provisional) beat axis.
  const raw = new Curve(beats.map((bt, i) => ({ t: bt.time, b: i })));
  // Shift so the anchor time resolves to its declared musical beat.
  const offset = anchor.b - raw.toBeat(anchor.t);
  return new Curve(beats.map((bt, i) => ({ t: bt.time, b: i + offset })));
}

/**
 * Resolve every aligned word (and its characters) into song coordinates.
 * Pure: re-run it with a different `recordingCurve` (e.g. after nudging the
 * anchor) to re-time the whole song without touching the measured input.
 */
export function bridgeTokens(
  align: AlignInput,
  recordingCurve: Curve,
  songCurve: Curve,
): TimedToken[] {
  const span = (startMs: number, endMs: number, text: string): TimedSpan => {
    const startB = recordingCurve.toBeat(startMs / 1000);
    const endB = recordingCurve.toBeat(endMs / 1000);
    return {
      text,
      startB,
      endB,
      startT: songCurve.toTime(startB),
      endT: songCurve.toTime(endB),
    };
  };

  return align.words.map((w) => ({
    ...span(w.startMs, w.endMs, w.text),
    chars: w.chars.map((c) => span(c.startMs, c.endMs, c.text)),
  }));
}
