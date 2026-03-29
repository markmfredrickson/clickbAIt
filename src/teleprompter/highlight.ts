/**
 * Pure functions for determining scroll position and active highlight
 * given a beat position and song payload. Runs in the browser.
 */

import type { SongPayload, Section } from "./types.js";

export interface HighlightState {
  /** Index of the active section, or -1 if before first section */
  sectionIndex: number;
  /** Index of the active lyric line within the section, or -1 */
  lyricIndex: number;
  /** Normalized scroll position within the section (0–1) for smooth scrolling */
  sectionProgress: number;
}

/**
 * Given the current beat, determine which section and lyric line
 * is active, plus a smooth scroll progress within the section.
 */
export function getHighlightState(payload: SongPayload, beat: number): HighlightState {
  const { sections } = payload;

  // Find active section: last section whose beat <= current beat
  let sectionIndex = -1;
  for (let i = sections.length - 1; i >= 0; i--) {
    if (beat >= sections[i].beat) {
      sectionIndex = i;
      break;
    }
  }

  if (sectionIndex === -1) {
    return { sectionIndex: -1, lyricIndex: -1, sectionProgress: 0 };
  }

  const section = sections[sectionIndex];

  // Find active lyric: last lyric whose beat <= current beat
  let lyricIndex = -1;
  for (let i = section.lyrics.length - 1; i >= 0; i--) {
    if (beat >= section.lyrics[i].beat) {
      lyricIndex = i;
      break;
    }
  }

  // Progress through the section (for smooth auto-scroll)
  const sectionProgress = section.durationBeats > 0
    ? Math.min(1, Math.max(0, (beat - section.beat) / section.durationBeats))
    : 0;

  return { sectionIndex, lyricIndex, sectionProgress };
}

/**
 * Compute a bar-level scroll position within a section.
 * Returns the bar number (0-based) and progress within that bar (0–1).
 */
export function getBarPosition(
  section: Section,
  beat: number,
  beatsPerBar: number,
): { bar: number; barProgress: number } {
  const beatInSection = beat - section.beat;
  const bar = Math.floor(beatInSection / beatsPerBar);
  const barProgress = (beatInSection % beatsPerBar) / beatsPerBar;
  return { bar: Math.max(0, bar), barProgress: Math.max(0, barProgress) };
}
