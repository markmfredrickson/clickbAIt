/**
 * Drawn notation: which bars of a score each chart channel draws, and the
 * shape of a drawing, shared by the bundle builder (which draws them ahead
 * of time, charts/notation-svg.ts) and the displays (which draw them live, or
 * show the bundle's).
 *
 * A drawing is one alphaTab render of a run of consecutive score bars: a
 * figure's bar on its own, or as much of a score row as runs on in the score.
 */

import type { RowDocument, ScoreBar, ChartKind } from "./rows.js";

export interface Drawing {
  svg: string;
  /** The SVG's size in px. */
  width: number;
  height: number;
  /** Where each bar lands, in px across the SVG. */
  bars: { x: number; w: number }[];
}

/** A drawing's name: its first score bar and how many bars. */
export const drawingKey = (start: number, count: number) => `${start}+${count}`;

/**
 * A score row's bars as pieces to draw: runs of consecutive score bars,
 * broken where the score jumps (a section that repeats a range). Bars the
 * score has nothing for are a piece of their own, with nothing to draw.
 */
export function scoreSegments(items: readonly ScoreBar[]): { first: number; count: number; start: number | null }[] {
  const out: { first: number; count: number; start: number | null }[] = [];
  items.forEach((bar, i) => {
    const last = out[out.length - 1];
    const runsOn =
      last &&
      (last.start === null ? bar.scoreBar === null : bar.scoreBar !== null && bar.scoreBar === last.start + last.count);
    if (runsOn) last.count++;
    else out.push({ first: i, count: 1, start: bar.scoreBar });
  });
  return out;
}

/** Per chart channel, every range of score bars it draws, each once. */
export function notationRanges(doc: RowDocument): { id: string; source: string; track: number; chart: ChartKind; ranges: { start: number; count: number }[] }[] {
  return doc.channels.flatMap((c) => {
    if (c.kind !== "figures" && c.kind !== "score") return [];
    const seen = new Map<string, { start: number; count: number }>();
    const add = (start: number, count: number) => seen.set(drawingKey(start, count), { start, count });
    for (const row of c.rows) {
      if (row.type === "figures") {
        for (const run of row.items) run.scoreBars.forEach((b, j) => b !== null && run.draw[j] && add(b, 1));
      } else {
        for (const seg of scoreSegments(row.items)) if (seg.start !== null) add(seg.start, seg.count);
      }
    }
    const ranges = [...seen.values()].sort((a, b) => a.start - b.start || a.count - b.count);
    return [{ id: c.id, source: c.source, track: c.track, chart: c.chart, ranges }];
  });
}
