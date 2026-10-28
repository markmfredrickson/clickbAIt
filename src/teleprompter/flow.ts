/**
 * Flowing a chart part to the pane it's shown in. The notes are one size on
 * a display, set by the distance between staff lines (`staff` in a URL), the
 * same for every part, song, rotation and pane: the size decides how many
 * bars fit a line and how many lines a page, never the other way round. A
 * row wraps onto as many lines as its bars need; only a bar wider than a
 * whole line is drawn smaller, to fit.
 *
 * A wrapped row is then cut into rows of its own where its lines allow, so a
 * pane pages by line rather than by whole sections that can be taller than
 * the pane. A score row can be cut at any line; a figure row only where a run
 * starts a new line, since a run repeats as a whole and its bars, played over
 * and over, belong on one page.
 *
 * The page code measures (pane-view.ts); this module only decides.
 */

import type { FigureRow, ScoreRow } from "./rows.js";

/** The distance between staff lines in alphaTab's drawings, in px at their own size. */
const DRAWN_STAFF_PX = 9;

/** The note size a display starts at: staff lines this many CSS px apart. */
export const DEFAULT_STAFF_PX = 10;

/** The zoom that draws staff lines `staffPx` apart. */
export function noteZoom(staffPx: number): number {
  return staffPx / DRAWN_STAFF_PX;
}

/** A note size from a URL (`staff=12`), or null when it isn't a sensible one. */
export function parseStaffPx(value: string | null): number | null {
  const n = Number(value);
  return value !== null && value !== "" && Number.isFinite(n) && n >= 4 && n <= 40 ? n : null;
}

/** The smallest a bar goes, rather than vanish. */
const FLOOR = 0.3;

/**
 * How much of the note size a bar is drawn at: all of it, unless the bar
 * alone (`width` px at the note size, with `extra` px beside it that doesn't
 * shrink, a run's count) is wider than a line of `room` px.
 */
export function barFit(width: number, room: number, extra = 0): number {
  if (width <= 0) return 1;
  return Math.max(FLOOR, Math.min(1, (room - extra) / width));
}

/**
 * How many bars of a run (or score row) go on each line: the largest number
 * that divides its bars evenly and lets every group fit `room`, the last
 * with `extra` beside it (the run's count). So a four-bar figure goes 2 + 2
 * where three would fit, never 3 + 1. Null when no even split puts more than
 * one bar on a line though more would fit: the bars then run on as they fit.
 */
export function lineGroup(widths: readonly number[], room: number, extra = 0): number | null {
  const n = widths.length;
  const fits = (g: number) => {
    for (let i = 0; i < n; i += g) {
      const w = widths.slice(i, i + g).reduce((s, x) => s + x, 0) + (i + g >= n ? extra : 0);
      if (w > room) return false;
    }
    return true;
  };
  for (let g = n; g > 1; g--) if (n % g === 0 && fits(g)) return g;
  // Only single bars divide evenly: one a line if no two fit together, otherwise as they fit.
  return n > 1 && widths.slice(0, 2).reduce((s, x) => s + x, 0) <= room ? null : 1;
}

/**
 * A section's score rows as one row. The build cuts a section into rows of
 * four bars; flowed, a section's bars run on line to line as they fit, and
 * only a new section starts a new line.
 */
export function joinSectionRows<R extends FigureRow | ScoreRow>(rows: readonly R[]): R[] {
  const out: R[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (last && last.type === "score" && row.type === "score" && last.section === row.section) {
      out[out.length - 1] = { ...last, items: [...last.items, ...row.items], end: row.end };
    } else out.push(row);
  }
  return out;
}

/** Which lines an item sits on: a bar's are one line, a wrapped run's several. */
export interface ItemLines {
  first: number;
  last: number;
}

/**
 * Cut each row where an item starts on a line after the one the item before
 * it ended on. `lines[r]` gives row r's items' lines, in order.
 */
export function splitRows<R extends FigureRow | ScoreRow>(rows: readonly R[], lines: readonly (readonly ItemLines[])[]): R[] {
  const out: R[] = [];
  rows.forEach((row, r) => {
    const at = lines[r];
    const cuts = [0];
    for (let i = 1; i < row.items.length; i++) if (at?.[i] && at[i - 1] && at[i].first > at[i - 1].last) cuts.push(i);
    if (cuts.length === 1) {
      out.push(row);
      return;
    }
    cuts.forEach((from, k) => {
      const to = k + 1 < cuts.length ? cuts[k + 1] : row.items.length;
      const items = row.items.slice(from, to);
      out.push({
        ...row,
        items,
        start: k === 0 ? row.start : items[0].start,
        end: to === row.items.length ? row.end : items[items.length - 1].end,
      });
    });
  });
  return out;
}
