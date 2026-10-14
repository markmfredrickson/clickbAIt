/**
 * Paging a pane. A pane shows a fixed number of its channel's rows and turns
 * them all at once, on the web and on e-ink alike. It turns as its bottom
 * row starts, so that row moves to the top, still lit, with what follows it
 * below: each page repeats the last row of the one before, and the bottom row
 * is never the one playing (except on the last page, which has nowhere to
 * turn). The display runs a beat ahead of the music, so the turn comes a beat
 * before the row is sung.
 */

export interface PanePage {
  /** Indices of the page's first and last rows. */
  first: number;
  last: number;
  /** When the page shows: its first row's start. */
  start: number;
}

export function panePages(rows: readonly { start: number }[], perPage: number): PanePage[] {
  const n = Math.max(1, Math.floor(perPage));
  const step = n === 1 ? 1 : n - 1;
  const pages: PanePage[] = [];
  for (let first = 0; first < rows.length; first += step) {
    const last = Math.min(rows.length - 1, first + n - 1);
    pages.push({ first, last, start: rows[first].start });
    if (last === rows.length - 1) break;
  }
  return pages;
}

/** The page showing at `beat`: the last one whose first row has started. */
export function panePageAt(pages: readonly { start: number }[], beat: number): number {
  let page = 0;
  for (let i = 1; i < pages.length && pages[i].start <= beat; i++) page = i;
  return page;
}

/** A row as laid out: its box in the pane's scroll space, and the beats it spans. */
export interface RowBox {
  top: number;
  height: number;
  start: number;
  end: number;
}

/**
 * The beat at a scroll offset: the row under it, read in proportion. Panes
 * scrolled by hand move together through this and `offsetAtBeat`, since the
 * same bar sits at different heights in different panes.
 */
export function beatAtOffset(rows: readonly RowBox[], offset: number): number {
  if (rows.length === 0) return 0;
  let i = 0;
  while (i + 1 < rows.length && rows[i + 1].top <= offset) i++;
  const r = rows[i];
  const frac = r.height > 0 ? Math.min(1, Math.max(0, (offset - r.top) / r.height)) : 0;
  return r.start + frac * (r.end - r.start);
}

/** The scroll offset of a beat: its row's top, plus how far through the row it falls. */
export function offsetAtBeat(rows: readonly RowBox[], beat: number): number {
  if (rows.length === 0) return 0;
  let i = 0;
  while (i + 1 < rows.length && rows[i + 1].start <= beat) i++;
  const r = rows[i];
  const span = r.end - r.start;
  const frac = span > 0 ? Math.min(1, Math.max(0, (beat - r.start) / span)) : 0;
  // A beat past this row's end but before the next row's start reads as the next row's top.
  if (beat >= r.end && i + 1 < rows.length) return rows[i + 1].top;
  return r.top + frac * r.height;
}
