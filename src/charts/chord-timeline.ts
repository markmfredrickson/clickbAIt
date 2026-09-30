/**
 * Chord times in the source recording (a `.lab` file's seconds) to beats on
 * the song's timeline, and back.
 *
 * It follows the same clip walk as the lyric words (see `clipAwareWords` in
 * build/lyrics-display.ts): each audio clip plays source `[from, from +
 * seconds]` from the current beat; silence just moves the beat on. A chord
 * is placed once per clip that plays its start, so a replayed region's chords
 * appear again. A chord already sounding when a clip starts goes on the
 * clip's first beat. Without clips the recording plays straight through.
 */

import type { Curve } from "../core/curve.js";
import type { Clip } from "../manifest.js";

export interface ChordTiming {
  /** Recording time → beat, from the beat map. */
  curve: Curve;
  clips?: readonly Clip[];
  /** The beat the first clip starts on: the beat map's first beat. */
  offset: number;
  bpm: number;
}

/** Walks the clips, calling `visit` for each audio clip with where it plays. */
function walkClips(
  timing: ChordTiming,
  visit: (clip: { from: number; to: number; fromBeat: number; startBeat: number; endBeat: number }) => void,
): void {
  let cursor = timing.offset;
  for (const clip of timing.clips ?? []) {
    if ("silence" in clip) {
      cursor += (clip.silence * timing.bpm) / 60;
      continue;
    }
    const to = clip.from + clip.seconds;
    const fromBeat = timing.curve.toBeat(clip.from);
    const length = timing.curve.toBeat(to) - fromBeat;
    visit({ from: clip.from, to, fromBeat, startBeat: cursor, endBeat: cursor + length });
    cursor += length;
  }
}

/** Where each segment's chord plays, as `{segment index, beat}`, in beat order. */
export function chordBeats(
  segments: readonly { start: number; end: number }[],
  timing: ChordTiming,
): { segment: number; beat: number }[] {
  if (!timing.clips?.length) {
    return segments.map((s, segment) => ({ segment, beat: timing.curve.toBeat(s.start) }));
  }
  const out: { segment: number; beat: number }[] = [];
  walkClips(timing, (clip) => {
    segments.forEach((s, segment) => {
      if (s.start >= clip.from && s.start < clip.to) {
        out.push({ segment, beat: clip.startBeat + timing.curve.toBeat(s.start) - clip.fromBeat });
      } else if (s.start < clip.from && s.end > clip.from) {
        out.push({ segment, beat: clip.startBeat });
      }
    });
  });
  return out.sort((a, b) => a.beat - b.beat);
}

/** The source time that plays at `beat`, or null if nothing does (silence, or past the end). */
export function sourceTime(beat: number, timing: ChordTiming): number | null {
  if (!timing.clips?.length) return timing.curve.toTime(beat);
  let found: number | null = null;
  walkClips(timing, (clip) => {
    if (found === null && beat >= clip.startBeat && beat < clip.endBeat) {
      found = timing.curve.toTime(clip.fromBeat + beat - clip.startBeat);
    }
  });
  return found;
}
