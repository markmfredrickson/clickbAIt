/**
 * A first draft of a song's sections from a transcription (a Guitar Pro file),
 * in place of guessed placeholder lengths.
 *
 * Boundaries come from the score's section markers, walked in play order, so a
 * section written once under a repeat sign or a D.S. is drafted each time it
 * plays. Leading bars that only rest are a count-in and are dropped. Names come
 * from the lyric sections only when there are exactly as many as the score has;
 * marker names rarely match ours, so otherwise they stay and a person decides.
 * Anything the draft can't settle goes on the decision list, never into a
 * guessed value.
 */

import type { ScoreLayout } from "./score-info.js";

export interface DraftSection {
  name: string;
  bars: number;
  /** Set only when it differs from the song's meter. */
  timeSignature?: [number, number];
  /** First and last written bar this section plays. */
  scoreBars: [number, number];
}

export interface ScoreDraft {
  sections: DraftSection[];
  /** The meter of the first drafted bar. */
  timeSignature: [number, number];
  countInBars: number;
  decisions: string[];
}

const sameMeter = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1];

export function draftSections(
  layout: ScoreLayout,
  opts: { lyricSections?: string[]; detectedBeats?: number } = {},
): ScoreDraft {
  const decisions: string[] = [];
  const markerAt = new Map(layout.markers.map((m) => [m.bar, m.text]));

  let countInBars = 0;
  while (countInBars < layout.playOrder.length && layout.silent[layout.playOrder[countInBars] - 1]) countInBars++;
  if (countInBars > 0) decisions.push(`dropped ${countInBars} count-in bar(s) that only rest at the start of the score`);
  const played = layout.playOrder.slice(countInBars);

  const groups: { name: string; bars: number[] }[] = [];
  for (const bar of played) {
    const marker = markerAt.get(bar);
    if (marker !== undefined || groups.length === 0) {
      groups.push({ name: marker ?? (layout.markers.length ? "Intro" : "Song"), bars: [] });
    }
    groups[groups.length - 1].bars.push(bar);
  }

  if (layout.markers.length === 0) {
    decisions.push("the score has no section markers, so every section boundary needs a person");
  }

  const lyric = opts.lyricSections;
  if (lyric && layout.markers.length > 0) {
    if (lyric.length === groups.length) groups.forEach((g, i) => (g.name = lyric[i]));
    else decisions.push(`${groups.length} score sections but ${lyric.length} lyric sections, so the marker names stay`);
  }

  const meterOf = (bar: number) => layout.meters[bar - 1];
  const timeSignature = played.length ? meterOf(played[0]) : ([4, 4] as [number, number]);
  const sections = groups.map((g): DraftSection => {
    const section: DraftSection = { name: g.name, bars: g.bars.length, scoreBars: [g.bars[0], g.bars[g.bars.length - 1]] };
    const runs: [number, number][] = [];
    for (const b of g.bars) {
      const last = runs[runs.length - 1];
      if (last && b === last[1] + 1) last[1] = b;
      else runs.push([b, b]);
    }
    if (runs.length > 1) {
      decisions.push(`${g.name} plays score bars ${runs.map(([a, z]) => `${a}–${z}`).join(", ")}, so its score link needs a person`);
    }
    const meter = meterOf(g.bars[0]);
    if (g.bars.some((b) => !sameMeter(meterOf(b), meter))) decisions.push(`${g.name} mixes meters, so its bars need splitting by hand`);
    else if (!sameMeter(meter, timeSignature)) section.timeSignature = meter;
    return section;
  });

  if (opts.detectedBeats !== undefined) {
    const scoreBeats = played.reduce((sum, b) => sum + meterOf(b)[0], 0);
    if (Math.abs(scoreBeats - opts.detectedBeats) > timeSignature[0]) {
      decisions.push(`the score plays ${scoreBeats} beats but the recording has ${opts.detectedBeats} detected beats`);
    }
  }

  return { sections, timeSignature, countInBars, decisions };
}
