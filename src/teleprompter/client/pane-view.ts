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
 * what's playing (see itemsAt in rows.ts). Each drawn bar is a piece of its
 * own, so a row wraps between any two bars; its notation is its slice of the
 * build's drawing, put in later (placeNotation). flowView then sizes a part
 * and cuts its rows by line (see flow.ts).
 */

import type { ChordRow, FigureItem, FigureRow, LyricRow, RowChannel, ScoreRow } from "../rows.js";
import { barGrid } from "../bar-grid.js";
import { barSegments, drawingKey, scoreSegments, type Drawing } from "../drawings.js";
import { barFit, joinSectionRows, lineGroup, splitRows, type ItemLines } from "../flow.js";

export interface RowView {
  el: HTMLElement;
  /** One element per item of the row, in order. */
  items: HTMLElement[];
  /** Chord rows: one element per bar. */
  bars?: HTMLElement[];
  /** Figure rows: per run, a box over each bar of its phrase (none for bars with no score). */
  runBars?: (HTMLElement | null)[][];
}

/** Where to draw one score bar: its piece's staff, from the drawing of the range of bars it's drawn with. */
export interface NotationTarget {
  el: HTMLElement;
  scoreBar: number;
  /** The range it's drawn with: the bars running on with it in its row or run. */
  start: number;
  count: number;
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
 * Put each target's bar in it: its slice of the drawing of its range, or,
 * once rows are cut by line (flowView) into ranges never drawn, of any
 * drawing that has the bar.
 */
export function placeNotation(view: ChannelView, drawings: Record<string, Drawing>): void {
  const anyWith = new Map<number, { drawing: Drawing; index: number }>();
  for (const [key, drawing] of Object.entries(drawings)) {
    const start = Number(key.split("+")[0]);
    drawing.bars.forEach((_, i) => {
      if (!anyWith.has(start + i)) anyWith.set(start + i, { drawing, index: i });
    });
  }
  const parsed = new Map<Drawing, SVGSVGElement | null>();
  for (const t of view.notation) {
    const own = drawings[drawingKey(t.start, t.count)];
    const found = own ? { drawing: own, index: t.scoreBar - t.start } : anyWith.get(t.scoreBar);
    if (!found) continue;
    if (!parsed.has(found.drawing)) parsed.set(found.drawing, parseSvg(found.drawing.svg));
    const svg = parsed.get(found.drawing);
    const bar = found.drawing.bars[found.index];
    if (!svg || !bar) continue;
    // The bar alone: the drawing cropped to it.
    const slice = svg.cloneNode(true) as SVGSVGElement;
    slice.setAttribute("viewBox", `${bar.x} 0 ${bar.w} ${found.drawing.height}`);
    slice.setAttribute("width", `${bar.w}px`);
    slice.setAttribute("height", `${found.drawing.height}px`);
    t.el.replaceChildren(slice);
  }
}

function parseSvg(svg: string): SVGSVGElement | null {
  const holder = document.createElement("div");
  holder.innerHTML = svg;
  return holder.querySelector("svg");
}

/** A drawn bar: its staff, and a box over it to light while it plays. */
function barPiece(scoreBar: number, seg: { start: number; count: number }, notation: NotationTarget[]): { piece: HTMLElement; box: HTMLElement } {
  const piece = el("div", "bar-piece");
  const staff = piece.appendChild(el("div", "notation"));
  const box = piece.appendChild(el("span", "score-bar"));
  notation.push({ el: staff, scoreBar, start: seg.start, count: seg.count });
  return { piece, box };
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
  const runBars: (HTMLElement | null)[][] = [];
  const items = row.items.map((run) => {
    const runEl = el("div", "figure-run");
    const bars: (HTMLElement | null)[] = run.scoreBars.map(() => null);
    if (run.scoreBars.every((b) => b === null)) {
      // Bars the score has nothing for: "– ×2".
      runEl.appendChild(el("span", "figure-label", "–"));
    } else {
      // The run's bars, a box over each to light while it plays, and its count after: "[bars] ×8".
      for (const seg of barSegments(run.scoreBars)) {
        if (seg.start === null) continue;
        for (let i = 0; i < seg.count; i++) {
          const { piece, box } = barPiece(seg.start + i, { start: seg.start, count: seg.count }, notation);
          bars[seg.first + i] = box;
          runEl.appendChild(piece);
        }
      }
    }
    runBars.push(bars);
    runEl.appendChild(el("span", "figure-label figure-count"));
    showPass(runEl, run, 0);
    line.appendChild(runEl);
    return runEl;
  });
  return { el: line, items, runBars };
}

function scoreRow(row: ScoreRow, notation: NotationTarget[]): RowView {
  const line = el("div", "row score-row");
  const items: HTMLElement[] = [];
  for (const seg of scoreSegments(row.items)) {
    for (let i = 0; i < seg.count; i++) {
      if (seg.start === null) {
        // A bar the score has nothing for: a rest-like gap, still lit in turn.
        items[seg.first + i] = line.appendChild(el("span", "score-bar blank", "–"));
      } else {
        const { piece, box } = barPiece(seg.start + i, { start: seg.start, count: seg.count }, notation);
        items[seg.first + i] = box;
        line.appendChild(piece);
      }
    }
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
 * Draw each bar at the display's note size (`--notation-zoom`, see flow.ts),
 * or smaller only where the bar alone is wider than its row (barFit), its
 * `--fit`. Rows wrap between bars to take the rest. `cap` holds every bar
 * smaller still: the last resort for a run too tall for its pane.
 */
export function fitRows(view: ChannelView, cap = 1): void {
  fitTogether(view.rows.map((r) => r.el), cap);
}

/** fitRows for row elements outside a view (the card's figures). */
export function fitTogether(rowEls: readonly HTMLElement[], cap = 1): void {
  for (const rowEl of rowEls) {
    const pieces = [...rowEl.querySelectorAll<HTMLElement>(".bar-piece")];
    for (const piece of pieces) piece.style.setProperty("--fit", "1");
    const room = rowEl.clientWidth - 2;
    if (room <= 0) continue;
    for (const piece of pieces) {
      const width = piece.querySelector(".notation")!.getBoundingClientRect().width;
      // A run's count stays beside its last bar, and doesn't shrink with it.
      const after = piece.nextElementSibling;
      const extra = after?.classList.contains("figure-count") ? after.getBoundingClientRect().width + gapOf(piece.parentElement!) : 0;
      piece.style.setProperty("--fit", String(Math.min(cap, barFit(width, room, extra))));
    }
  }
}

/**
 * Break each run's bars, and each score row's, into equal groups that hold
 * together on a line (see lineGroup): a four-bar figure 2 + 2 rather than
 * 3 + 1. Run after the notation is sized; groups from an earlier run are undone first.
 */
export function groupBars(view: ChannelView): void {
  for (const { el: rowEl } of view.rows) {
    rowEl.querySelectorAll(".bar-group").forEach((g) => g.replaceWith(...g.children));
    const room = rowEl.clientWidth - 2;
    if (room <= 0) continue;
    const runs = rowEl.classList.contains("score-row") ? [rowEl] : [...rowEl.querySelectorAll<HTMLElement>(".figure-run")];
    for (const run of runs) {
      const bars = [...run.children].filter((c) => c.classList.contains("bar-piece") || c.classList.contains("blank")) as HTMLElement[];
      if (bars.length < 2) continue;
      const label = run.querySelector<HTMLElement>(":scope > .figure-count");
      const extra = label && label.getClientRects().length ? label.getBoundingClientRect().width + parseFloat(getComputedStyle(label).marginLeft || "0") : 0;
      const g = lineGroup(bars.map((b) => b.getBoundingClientRect().width), room, extra);
      if (g === null) continue;
      for (let i = 0; i < bars.length; i += g) {
        const group = el("div", "bar-group");
        run.insertBefore(group, bars[i]);
        for (const b of bars.slice(i, i + g)) group.appendChild(b);
      }
    }
  }
}

function gapOf(flex: HTMLElement): number {
  return parseFloat(getComputedStyle(flex).columnGap) || 0;
}

/**
 * Which lines of its row each item of a chart row sits on, by where its
 * pieces landed: a piece starting left of where the one before it ended has
 * wrapped onto the next line.
 */
function itemLines(channel: RowChannel, view: ChannelView): ItemLines[][] {
  if (channel.kind !== "figures" && channel.kind !== "score") return [];
  return view.rows.map((rowView, r) => {
    let line = 0;
    let right = -Infinity;
    const lineOf = (e: Element) => {
      const box = e.getBoundingClientRect();
      if (box.left < right - 1) line++;
      right = box.right;
      return line;
    };
    if (channel.rows[r].type === "figures") {
      return rowView.items.map((runEl) => {
        // A count that isn't shown (a run played once) takes no place on a line.
        const parts = [...runEl.querySelectorAll(".bar-piece, .figure-label")].filter((e) => e.getClientRects().length > 0);
        if (!parts.length) {
          const l = lineOf(runEl);
          return { first: l, last: l };
        }
        const first = lineOf(parts[0]);
        for (let i = 1; i < parts.length; i++) lineOf(parts[i]);
        return { first, last: line };
      });
    }
    // A bar's box sits in its piece; a blank bar is its own.
    return rowView.items.map((item) => {
      const l = lineOf(item.classList.contains("blank") ? item : item.parentElement!);
      return { first: l, last: l };
    });
  });
}

/**
 * A chart channel drawn, sized and cut into rows by line, for rows of the
 * width `mount` puts them at (see flow.ts): `mount` takes the rows'
 * elements, replacing any it was given before. Other channels are drawn as
 * they are. No row is left taller than `maxRowHeight`, unless the notation
 * would go below its floor; that is the only thing that shrinks every bar.
 */
export function flowView(
  channel: RowChannel,
  drawings: Record<string, Drawing>,
  mount: (rows: HTMLElement[]) => void,
  maxRowHeight = Infinity,
): { channel: RowChannel; view: ChannelView } {
  const draw = (c: RowChannel, cap: number) => {
    const view = channelView(c);
    placeNotation(view, drawings);
    mount(view.rows.map((r) => r.el));
    fitRows(view, cap);
    groupBars(view);
    return view;
  };
  if (channel.kind !== "figures" && channel.kind !== "score") return { channel, view: draw(channel, 1) };
  // A section's bars flow as one row; only a new section starts a new line.
  channel = { ...channel, rows: joinSectionRows(channel.rows as (FigureRow | ScoreRow)[]) } as RowChannel;
  let view = draw(channel, 1);
  let cap = 1;
  for (let attempt = 0; ; attempt++) {
    const rows = splitRows(channel.rows as (FigureRow | ScoreRow)[], itemLines(channel, view));
    const flowed = { ...channel, rows } as RowChannel;
    const flowedView = rows.length === channel.rows.length ? view : draw(flowed, cap);
    const tallest = Math.max(0, ...flowedView.rows.map((r) => r.el.offsetHeight));
    if (tallest <= maxRowHeight || attempt === 2 || cap <= 0.3) return { channel: flowed, view: flowedView };
    // A run too tall for the pane, the one thing that overrides the note size: smaller, flowed again.
    cap = Math.max(0.3, (cap * maxRowHeight) / tallest);
    view = draw(channel, cap);
  }
}
