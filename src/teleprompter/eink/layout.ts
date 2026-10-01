/**
 * E-ink decks: the parts shared by the relay (which renders pages) and the
 * e-ink client (which shows them and follows the beat).
 *
 * E-ink browsers (the Kindle's included) re-scale and re-flow pages on their
 * own, so the relay lays the song out in headless Chrome at the device's exact
 * size and hands over images. Like the web prompter, each channel is a pane,
 * stacked in the order asked for, and each pane is its own set of page images
 * that turns on its own (see panes.ts). Chrome-specific work lives in
 * render.ts.
 */

/**
 * Something to light on a page, in CSS px from the pane's top-left, with the
 * beats it plays: a lyric line, a chord bar, a score bar, or a figure run
 * (which also knows its passes, so the client can show which is playing).
 */
export interface Mark {
  start: number;
  end: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Figure runs: how many times through, and the beats in each. */
  count?: number;
  passBeats?: number;
}

export interface EinkPage {
  /** When the page shows: its first row's start (see panePageAt). */
  start: number;
  src: string;
  marks: Mark[];
}

export interface EinkPane {
  /** The channel's id. */
  id: string;
  kind: "lyrics" | "chords" | "figures" | "score";
  /** Its label: "Rhythm guitar · tab". */
  title: string;
  /** Where the pane sits on the screen, and its height, in CSS px. */
  top: number;
  height: number;
  pages: EinkPage[];
}

export interface EinkDeck {
  slug: string;
  key: string;
  width: number;
  height: number;
  panes: EinkPane[];
  /** The card before the song: its image, shown while the song is at its start. */
  card?: { src: string; startBeat: number };
}

/** The mark playing at `beat`, or -1. A mark that has started wins over one ending. */
export function markAt(marks: readonly Mark[], beat: number): number {
  for (let i = marks.length - 1; i >= 0; i--) {
    if (marks[i].start <= beat && beat < marks[i].end) return i;
  }
  return -1;
}

/** Which time through a figure run is playing at `beat`, or null outside it or for another mark. */
export function passOf(mark: Mark, beat: number): { pass: number; of: number } | null {
  if (!mark.count || !mark.passBeats || beat < mark.start || beat >= mark.end) return null;
  return { pass: Math.floor((beat - mark.start) / mark.passBeats) + 1, of: mark.count };
}
