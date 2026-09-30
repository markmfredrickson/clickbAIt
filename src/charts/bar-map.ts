/**
 * Which score bar plays in each bar of our song, for one score file.
 *
 * The score's `sections` links say which score bars go with which of our
 * sections; this expands them to one entry per song bar, with the beat it
 * starts on. A song bar no link covers gets `scoreBar: null` and shows no
 * notation. Length checks against our sections already happened in the
 * manifest schema; what's left to check here needs the score itself.
 */

import { barBeats, ordinal, sectionStarts, type PlaceableSection, type ScoreSpec } from "../manifest.js";
import type { ScoreInfo } from "./score-info.js";

/** A section placed on the song's timeline. */
export interface SongSection {
  name: string;
  bars: number;
  /** 1 for the first section with this name, 2 for the second, ... */
  occurrence: number;
  /** 1-based song bar the section starts on. */
  firstBar: number;
  startBeat: number;
  /** The section's meter (most of its bars). */
  beatsPerBar: number;
  /** Each bar's length in beats (see manifest `meters`). */
  barBeats: number[];
}

export interface MappedBar {
  /** 1-based bar of our song. */
  songBar: number;
  /** Index into the song's sections. */
  section: number;
  startBeat: number;
  beats: number;
  /** 1-based score bar that plays here, or null for none. */
  scoreBar: number | null;
}

export function songSections(
  sections: readonly (PlaceableSection & { name: string })[],
  timeSignature: readonly [number, number],
): SongSection[] {
  const starts = sectionStarts(sections, timeSignature);
  const seen = new Map<string, number>();
  let firstBar = 1;
  return sections.map((s, i) => {
    const occurrence = (seen.get(s.name) ?? 0) + 1;
    seen.set(s.name, occurrence);
    const placed = {
      name: s.name,
      bars: s.bars,
      occurrence,
      firstBar,
      startBeat: starts[i],
      beatsPerBar: s.timeSignature?.[0] ?? timeSignature[0],
      barBeats: barBeats(s, timeSignature),
    };
    firstBar += s.bars;
    return placed;
  });
}

export function mapScore(
  spec: ScoreSpec,
  sections: readonly SongSection[],
  score: ScoreInfo,
): { bars: MappedBar[]; errors: string[] } {
  const errors: string[] = [];

  const bars: MappedBar[] = [];
  sections.forEach((s, si) => {
    // A link for this occurrence wins over a name-wide one.
    const link =
      spec.sections.find((l) => l.section === s.name && l.occurrence === s.occurrence) ??
      spec.sections.find((l) => l.section === s.name && l.occurrence === undefined);
    if (link && link.bars[1] > score.bars) {
      errors.push(
        `score "${spec.id}": ${s.name} (${ordinal(s.occurrence)}) uses score bars ` +
          `${link.bars[0]}–${link.bars[1]}, but the score ends at bar ${score.bars}`,
      );
    }
    const length = link ? link.bars[1] - link.bars[0] + 1 : 0;
    let beat = s.startBeat;
    for (let i = 0; i < s.bars; i++) {
      const beats = s.barBeats[i] ?? s.beatsPerBar;
      bars.push({
        songBar: s.firstBar + i,
        section: si,
        startBeat: beat,
        beats,
        scoreBar: link ? link.bars[0] + (i % length) : null,
      });
      beat += beats;
    }
  });
  return { bars, errors };
}

/** The bar holding `beat` (`bar` 1-based within its section), or null outside the song. */
export function songBarAt(
  sections: readonly { startBeat: number; barBeats: readonly number[] }[],
  beat: number,
): { section: number; bar: number; startBeat: number; beats: number } | null {
  for (let section = 0; section < sections.length; section++) {
    let start = sections[section].startBeat;
    for (let i = 0; i < sections[section].barBeats.length; i++) {
      const beats = sections[section].barBeats[i];
      if (beat >= start - 1e-9 && beat < start + beats - 1e-9) return { section, bar: i + 1, startBeat: start, beats };
      start += beats;
    }
  }
  return null;
}
