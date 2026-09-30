/**
 * The song as a strip, left to right: each section a block as wide as its
 * share of the song, and how far playback has got. Displays draw it (the
 * prompter under its header; the control page and e-ink can share it), so
 * the proportions are worked out once, here.
 */

import type { MeteredSection } from "./position.js";

export interface MapSegment {
  /** Where the section starts, as a fraction of the song. */
  start: number;
  /** Its length, as a fraction of the song. */
  width: number;
}

export interface SongProgress {
  /** Index of the section playing, or -1 before the downbeat. */
  section: number;
  /** How far through that section, 0 to 1. */
  inSection: number;
  /** How far through the song, 0 to 1. */
  inSong: number;
}

const length = (s: MeteredSection) => s.bars * s.beatsPerBar;

export function songMap(sections: readonly MeteredSection[]): MapSegment[] {
  const total = sections.reduce((sum, s) => sum + length(s), 0);
  if (total <= 0) return [];
  let at = 0;
  return sections.map((s) => {
    const segment = { start: at / total, width: length(s) / total };
    at += length(s);
    return segment;
  });
}

export function songProgress(sections: readonly MeteredSection[], beat: number): SongProgress {
  if (sections.length === 0 || beat < sections[0].startBeat) return { section: -1, inSection: 0, inSong: 0 };
  const first = sections[0].startBeat;
  const last = sections[sections.length - 1];
  const total = last.startBeat + length(last) - first;
  let i = 0;
  while (i + 1 < sections.length && sections[i + 1].startBeat <= beat) i++;
  const s = sections[i];
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  return {
    section: i,
    inSection: length(s) > 0 ? clamp((beat - s.startBeat) / length(s)) : 1,
    inSong: total > 0 ? clamp((beat - first) / total) : 1,
  };
}
