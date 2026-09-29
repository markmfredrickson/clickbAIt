/**
 * Which score bar plays in each bar of our song, for one chart.
 *
 * The chart's `sections` links say which score bars go with which of our
 * sections; this expands them to one entry per song bar, with the beat it
 * starts on. A song bar no link covers gets `scoreBar: null` and shows no
 * notation. Length checks against our sections already happened in the
 * manifest schema; what's left to check here needs the score itself.
 */

import { ordinal, sectionStarts, type ChartSpec } from "../manifest.js";
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
  beatsPerBar: number;
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
  sections: readonly { name: string; bars: number; timeSignature?: readonly [number, number] }[],
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
    };
    firstBar += s.bars;
    return placed;
  });
}

export function mapChart(
  chart: ChartSpec,
  sections: readonly SongSection[],
  score: ScoreInfo,
): { bars: MappedBar[]; errors: string[] } {
  const errors: string[] = [];
  if (chart.track >= score.tracks.length) {
    errors.push(`chart "${chart.id}": the score has ${score.tracks.length} tracks, so there is no track ${chart.track}`);
  }

  const bars: MappedBar[] = [];
  sections.forEach((s, si) => {
    // A link for this occurrence wins over a name-wide one.
    const link =
      chart.sections.find((l) => l.section === s.name && l.occurrence === s.occurrence) ??
      chart.sections.find((l) => l.section === s.name && l.occurrence === undefined);
    if (link && link.bars[1] > score.bars) {
      errors.push(
        `chart "${chart.id}": ${s.name} (${ordinal(s.occurrence)}) uses score bars ` +
          `${link.bars[0]}–${link.bars[1]}, but the score ends at bar ${score.bars}`,
      );
    }
    const length = link ? link.bars[1] - link.bars[0] + 1 : 0;
    for (let i = 0; i < s.bars; i++) {
      bars.push({
        songBar: s.firstBar + i,
        section: si,
        startBeat: s.startBeat + i * s.beatsPerBar,
        beats: s.beatsPerBar,
        scoreBar: link ? link.bars[0] + (i % length) : null,
      });
    }
  });
  return { bars, errors };
}
