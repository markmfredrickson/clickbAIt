/**
 * A channel's rows as page elements, for the web prompter's panes and for the
 * e-ink renderer (which runs this same code in headless Chrome), so both draw
 * rows alike and only their styles differ.
 *
 *   lyrics  a line of words
 *   chords  a line of bars, each as wide as its beats, chords on a grid
 *   drums   a line of groove runs: "(A) [staff] ×8" the first time a section
 *           plays a groove, the letter alone after that
 *
 * Every row and item element is returned in order, so a display can light
 * what's playing (see itemsAt in rows.ts).
 */

import type { ChordRow, DrumItem, DrumRow, LyricRow, RowChannel } from "../rows.js";
import { barGrid } from "../bar-grid.js";

export interface RowView {
  el: HTMLElement;
  /** One element per item of the row, in order. */
  items: HTMLElement[];
  /** Chord rows: one element per bar. */
  bars?: HTMLElement[];
}

/** A drum run's notation to draw: into `el`, the score's bar `scoreBar`. */
export interface NotationTarget {
  el: HTMLElement;
  scoreBar: number;
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
  if (channel.kind === "lyrics") return { rows: channel.rows.map(lyricRow), notation: [] };
  if (channel.kind === "chords") {
    // Every row is as wide as the longest, so bars line up down the pane.
    const width = Math.max(0, ...channel.rows.map((r) => r.end - r.start));
    return { rows: channel.rows.map((r, i) => chordRow(r, width, heldChord(channel.rows, i))), notation: [] };
  }
  const notation: NotationTarget[] = [];
  return { rows: channel.rows.map((r) => drumRow(r, notation)), notation };
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

/** The run's letter: "(A)" where its notation is drawn, "A" alone, "–" for no score bar. */
function runLetter(run: DrumItem): string {
  return run.letter === null ? "–" : draws(run) ? `(${run.letter})` : run.letter;
}

const draws = (run: DrumItem) => run.first && run.letter !== null && run.scoreBar !== null;

function drumRow(row: DrumRow, notation: NotationTarget[]): RowView {
  const line = el("div", "row drum-row");
  const items = row.items.map((run) => {
    const runEl = el("div", "drum-run" + (run.first ? " first" : ""));
    const label = el("span", "drum-label", runLetter(run));
    if (draws(run)) {
      // In line: the letter, the groove, and its count after it: (B) [groove] ×8.
      const body = el("div", "drum-body");
      body.appendChild(label);
      const staff = el("div", "drum-notation");
      body.appendChild(staff);
      body.appendChild(el("span", "drum-label drum-count"));
      runEl.appendChild(body);
      notation.push({ el: staff, scoreBar: run.scoreBar! });
    } else {
      runEl.appendChild(label);
    }
    showPass(runEl, run, 0);
    line.appendChild(runEl);
    return runEl;
  });
  return { el: line, items };
}

/**
 * Show a run's count ("×4") after its notation or its letter, and while it
 * plays, which pass this is ("3/4"), hung under the count so the line
 * doesn't reflow as the highlight moves. `pass` 0 shows none.
 */
export function showPass(runEl: HTMLElement, run: DrumItem, pass: number): void {
  const count = run.count > 1 ? `×${run.count}` : "";
  const countEl = runEl.querySelector<HTMLElement>(".drum-count");
  const target = countEl ?? runEl.querySelector<HTMLElement>(".drum-label")!;
  target.textContent = countEl ? count : runLetter(run) + (count ? " " + count : "");
  if (pass > 0 && run.count > 1) target.appendChild(el("span", "drum-pass", `${pass}/${run.count}`));
}
