/**
 * A channel's rows as page elements, for the web prompter's panes and for the
 * e-ink renderer (which runs this same code in headless Chrome), so both draw
 * rows alike and only their styles differ.
 *
 *   lyrics   a line of words
 *   chords   a line of bars, each as wide as its beats, chords on a grid
 *   figures  a line of runs, each drawn with its count: "[staff] ×8"
 *   score    a line of drawn bars, a box over each to light while it plays
 *
 * Every row and item element is returned in order, so a display can light
 * what's playing (see itemsAt in rows.ts). Notation is drawn into the
 * returned targets later, live or from a bundle's drawings (placeDrawing).
 */

import type { ChordRow, FigureItem, FigureRow, LyricRow, RowChannel, ScoreRow } from "../rows.js";
import { barGrid } from "../bar-grid.js";
import { barSegments, scoreSegments } from "../drawings.js";

export interface RowView {
  el: HTMLElement;
  /** One element per item of the row, in order. */
  items: HTMLElement[];
  /** Chord rows: one element per bar. */
  bars?: HTMLElement[];
}

/** Where to draw a range of score bars, and the boxes to place over its bars. */
export interface NotationTarget {
  el: HTMLElement;
  start: number;
  count: number;
  /** Score rows: one box per bar, placed once the drawing says where its bars are. */
  boxes: HTMLElement[];
}

export interface ChannelView {
  rows: RowView[];
  notation: NotationTarget[];
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function channelView(channel: RowChannel): ChannelView {
  const notation: NotationTarget[] = [];
  if (channel.kind === "lyrics") return { rows: channel.rows.map(lyricRow), notation };
  if (channel.kind === "chords") {
    // Every row is as wide as the longest, so bars line up down the pane.
    const width = Math.max(0, ...channel.rows.map((r) => r.end - r.start));
    return { rows: channel.rows.map((r, i) => chordRow(r, width, heldChord(channel.rows, i))), notation };
  }
  const rows: (FigureRow | ScoreRow)[] = channel.rows;
  return { rows: rows.map((r) => (r.type === "figures" ? figureRow(r, notation) : scoreRow(r, notation))), notation };
}

/**
 * Put a drawing in its target (its SVG, when it comes from a bundle) and
 * place the target's bar boxes over the bars, as fractions of its width so
 * they follow any zoom.
 */
export function placeDrawing(target: NotationTarget, drawing: { width: number; bars: { x: number; w: number }[] }, svg?: string): void {
  if (svg !== undefined) target.el.innerHTML = svg;
  target.boxes.forEach((box, i) => {
    const bar = drawing.bars[i];
    if (!bar || !drawing.width) return;
    box.style.left = `${(bar.x / drawing.width) * 100}%`;
    box.style.width = `${(bar.w / drawing.width) * 100}%`;
    box.style.display = "block";
  });
}

function lyricRow(row: LyricRow): RowView {
  const line = el("div", "row lyric-row" + (row.tag && /backing/i.test(row.tag) ? " bv" : ""));
  const items = row.items.map((w, i) => {
    if (i > 0) line.appendChild(document.createTextNode(" "));
    const word = el("span", "word", w.text);
    line.appendChild(word);
    return word;
  });
  return { el: line, items };
}

/** The chord still sounding when row `i` starts, if the row doesn't start with its own. */
function heldChord(rows: readonly ChordRow[], i: number): string | null {
  const row = rows[i];
  if (row.items.some((c) => Math.abs(c.start - row.start) < 1e-6)) return null;
  for (let r = i - 1; r >= 0; r--) {
    const last = rows[r].items[rows[r].items.length - 1];
    if (last) return last.end > row.start + 1e-6 ? last.chord : null;
  }
  return null;
}

function chordRow(row: ChordRow, width: number, held: string | null): RowView {
  const line = el("div", "row chord-row");
  const items: HTMLElement[] = [];
  const bars = row.bars.map((bar, k) => {
    const beats = bar.end - bar.start;
    // A chord before the row's first bar (a pickup) sits at its start.
    const inBar = row.items
      .map((c, index) => ({ c, index }))
      .filter(({ c }) => (k === 0 && c.start < bar.start) || (c.start >= bar.start - 1e-6 && c.start < bar.end - 1e-6));
    const placed = inBar.map(({ c }) => ({ at: Math.max(0, (c.start - bar.start) / beats) }));
    const showHeld = k === 0 && held !== null && !placed.some((p) => p.at === 0);
    const grid = barGrid({ beats, chords: showHeld ? [{ at: 0 }, ...placed] : placed });
    const barEl = el("div", "bar" + (k === row.bars.length - 1 ? " end" : ""));
    barEl.style.flexGrow = String(beats);
    barEl.style.gridTemplateColumns = `repeat(${grid.columns}, 1fr)`;
    if (showHeld) {
      const h = el("span", "chord held", held!);
      h.style.gridColumnStart = String(grid.starts[0]);
      barEl.appendChild(h);
    }
    inBar.forEach(({ c, index }, j) => {
      const chord = el("span", "chord", c.chord);
      chord.style.gridColumnStart = String(grid.starts[j + (showHeld ? 1 : 0)]);
      barEl.appendChild(chord);
      items[index] = chord;
    });
    line.appendChild(barEl);
    return barEl;
  });
  const room = width - (row.end - row.start);
  if (room > 1e-6) {
    const pad = el("div", "pad");
    pad.style.flexGrow = String(room);
    line.appendChild(pad);
  }
  return { el: line, items, bars };
}

function figureRow(row: FigureRow, notation: NotationTarget[]): RowView {
  const line = el("div", "row figure-row");
  const items = row.items.map((run) => {
    const runEl = el("div", "figure-run");
    if (!run.draw) {
      // Bars the score has nothing for.
      runEl.appendChild(el("span", "figure-label", "–"));
    } else {
      // The run's bars, and its count after: "[bars] ×8".
      const body = el("div", "figure-body");
      for (const seg of barSegments(run.scoreBars)) {
        if (seg.start === null) continue;
        const staff = el("div", "notation");
        body.appendChild(staff);
        notation.push({ el: staff, start: seg.start, count: seg.count, boxes: [] });
      }
      runEl.appendChild(body);
    }
    runEl.appendChild(el("span", "figure-label figure-count"));
    showPass(runEl, run, 0);
    line.appendChild(runEl);
    return runEl;
  });
  return { el: line, items };
}

function scoreRow(row: ScoreRow, notation: NotationTarget[]): RowView {
  const line = el("div", "row score-row");
  const items: HTMLElement[] = [];
  for (const seg of scoreSegments(row.items)) {
    const segEl = el("div", "score-seg" + (seg.start === null ? " empty" : ""));
    if (seg.start === null) {
      // Bars the score has nothing for: a rest-like gap, still lit in turn.
      for (let i = 0; i < seg.count; i++) items[seg.first + i] = segEl.appendChild(el("span", "score-bar blank", "–"));
    } else {
      const staff = el("div", "notation");
      segEl.appendChild(staff);
      const boxes: HTMLElement[] = [];
      for (let i = 0; i < seg.count; i++) boxes.push((items[seg.first + i] = segEl.appendChild(el("span", "score-bar"))));
      notation.push({ el: staff, start: seg.start, count: seg.count, boxes });
    }
    line.appendChild(segEl);
  }
  return { el: line, items };
}

/**
 * Show a run's count ("×4") after it, and under it which time through this
 * is ("3/4"): 0 before the song gets there, the count once it's past. The
 * pass hangs under the count so the line doesn't reflow as it changes.
 */
export function showPass(runEl: HTMLElement, run: FigureItem, pass: number): void {
  const countEl = runEl.querySelector<HTMLElement>(".figure-count")!;
  countEl.textContent = run.count > 1 ? `×${run.count}` : "";
  if (run.count > 1) countEl.appendChild(el("span", "figure-pass", `${pass}/${run.count}`));
}

/**
 * Scale down any notation too wide for its row: a figure run or a piece of a
 * score row wider than the row gets a smaller zoom (the `--fit` variable its
 * notation multiplies by), so nothing runs off the side of the screen.
 */
export function fitRows(view: ChannelView): void {
  for (const row of view.rows) fitRow(row.el);
}

/** fitRows for one row's element (the card's figures are rows on their own). */
export function fitRow(rowEl: HTMLElement): void {
  {
    const room = rowEl.clientWidth;
    if (!room) return;
    rowEl.querySelectorAll<HTMLElement>(".figure-run, .score-seg").forEach((part) => {
      if (!part.querySelector(".notation")) return;
      part.style.setProperty("--fit", "1");
      const width = part.scrollWidth;
      if (width <= room) return;
      // Only the notation shrinks; the count after it keeps its size.
      let staves = 0;
      part.querySelectorAll(".notation").forEach((n) => (staves += n.getBoundingClientRect().width));
      const fit = staves > 0 ? (room - (width - staves) - 2) / staves : 1;
      part.style.setProperty("--fit", String(Math.max(0.3, Math.min(1, fit))));
    });
  }
}
