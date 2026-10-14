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

/**
 * Pages that fill a pane of `available` height, for a page that has a screen
 * (or a frame of one) to itself rather than a set number of rows. A page holds
 * as many whole rows as fit; a row taller than the space gets a page alone.
 * Each page starts on the last row of the one before, as with `panePages`,
 * when that row and the next fit together; otherwise it starts on the next.
 */
export function pagesByHeight(rows: readonly { start: number; height: number }[], available: number): PanePage[] {
  const pages: PanePage[] = [];
  let first = 0;
  while (first < rows.length) {
    let last = first;
    let used = rows[first].height;
    while (last + 1 < rows.length && used + rows[last + 1].height <= available) used += rows[++last].height;
    pages.push({ first, last, start: rows[first].start });
    if (last === rows.length - 1) break;
    const repeat = last > first && rows[last].height + rows[last + 1].height <= available;
    first = repeat ? last : last + 1;
  }
  return pages;
}
