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
  /** Figure runs: a box over each bar of one time through, and each bar's beats. */
  bars?: { x: number; y: number; w: number; h: number }[];
  barBeats?: number[];
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

/** The box to light for `mark` at `beat`: the bar playing, in a run with its bars boxed; otherwise the whole mark. */
export function boxAt(mark: Mark, beat: number): { x: number; y: number; w: number; h: number } {
  const { x, y, w, h } = mark;
  if (!mark.bars?.length || !mark.barBeats || !mark.passBeats) return { x, y, w, h };
  let at = (((beat - mark.start) % mark.passBeats) + mark.passBeats) % mark.passBeats;
  for (let i = 0; i < mark.bars.length; i++) {
    if (at < (mark.barBeats[i] ?? Infinity) || i === mark.bars.length - 1) return mark.bars[i];
    at -= mark.barBeats[i];
  }
  return { x, y, w, h };
}

/**
 * Which way the Kindle is turned (`?rotate=left|right`): the page is drawn
 * turned the other way, so it reads upright held sideways.
 */
export type Rotation = "left" | "right" | null;

export function parseRotation(value: string | null): Rotation {
  return value === "left" || value === "right" ? value : null;
}

/** The CSS transform that turns a page laid out on its side onto a `screenW` × `screenH` screen. */
export function rotationTransform(rotation: Rotation, screenW: number, screenH: number): string {
  if (rotation === "left") return `translate(${screenW}px, 0) rotate(90deg)`;
  if (rotation === "right") return `translate(0, ${screenH}px) rotate(-90deg)`;
  return "";
}

/** A point on the screen as a point on the turned page. */
export function screenToPage(rotation: Rotation, x: number, y: number, screenW: number, screenH: number): { x: number; y: number } {
  if (rotation === "left") return { x: y, y: screenW - x };
  if (rotation === "right") return { x: screenH - y, y: x };
  return { x, y };
}
