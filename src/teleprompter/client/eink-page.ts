/**
 * The e-ink renderer's page, run in headless Chrome by eink/render.ts: it
 * draws every pane's rows with the prompter's own pane-view (and the
 * notation the rows carry), then shows one page of one pane at a time for a
 * screenshot and reports where its marks landed.
 */

import type { FigureRow, RowChannel, RowDocument, ScoreRow } from "../rows.js";
import type { Mark } from "../eink/layout.js";
import { flowView, type ChannelView } from "./pane-view.js";
import { cardView, fitCard, type CardSong } from "./card-view.js";

interface Drawn {
  channel: RowChannel;
  view: ChannelView;
}

let drawn: Drawn[] = [];

const work = () => document.getElementById("work")!;
const stage = () => document.getElementById("stage")!;

/**
 * Draw each channel's rows, with the notation the rows carry, flowed to the
 * screen's width with no row taller than `maxRowHeight` (see flowView).
 * Returns each channel's rows as flowed, which the panes page by.
 */
async function setup(doc: RowDocument, maxRowHeight: number): Promise<{ start: number }[][]> {
  work().innerHTML = "";
  // The music font must be in before anything is measured.
  await document.fonts.ready;
  drawn = doc.channels.map((source) => {
    const pane = document.createElement("div");
    pane.className = `pane pane-${source.kind}`;
    work().appendChild(pane);
    return flowView(source, doc.notation?.[source.id] ?? {}, (rows) => pane.replaceChildren(...rows), maxRowHeight);
  });
  return drawn.map((d) => d.channel.rows.map((r) => ({ start: r.start })));
}

/** The height of the tallest of these pages of pane `i`. */
function measure(i: number, pages: readonly { first: number; last: number }[]): number {
  const rows = drawn[i].view.rows.map((r) => r.el);
  let height = 0;
  for (const p of pages) height = Math.max(height, rows[p.last].offsetTop + rows[p.last].offsetHeight - rows[p.first].offsetTop);
  return height;
}

/** Each row's height in pane `i`, for pages that hold as many rows as fit. */
function rowHeights(i: number): number[] {
  return drawn[i].view.rows.map((r) => r.el.offsetHeight);
}

/**
 * Put one page of pane `i` on the stage at `height` px, ruled off below
 * unless it's the last pane, and return its marks.
 */
function show(i: number, page: { first: number; last: number }, height: number, last: boolean): Mark[] {
  const { channel, view } = drawn[i];
  const s = stage();
  s.innerHTML = "";
  s.className = `pane pane-${channel.kind}${last ? "" : " ruled"}`;
  s.style.height = `${height}px`;
  const origin = s.getBoundingClientRect();
  const marks: Mark[] = [];
  const box = (el: Element) => {
    // A run has no box of its own (its bars flow in the row): it spans what's in it.
    const shown = el.classList.contains("figure-run") ? [...el.children].filter((c) => c.getClientRects().length) : [el];
    const rs = shown.map((e) => e.getBoundingClientRect());
    if (!rs.length) return { x: 0, y: 0, w: 0, h: 0 };
    const left = Math.min(...rs.map((r) => r.left)), top = Math.min(...rs.map((r) => r.top));
    const right = Math.max(...rs.map((r) => r.right)), bottom = Math.max(...rs.map((r) => r.bottom));
    return { x: left - origin.left, y: top - origin.top, w: right - left, h: bottom - top };
  };
  const placed: HTMLElement[] = [];
  for (let r = page.first; r <= page.last; r++) {
    const copy = view.rows[r].el.cloneNode(true) as HTMLElement;
    s.appendChild(copy);
    placed.push(copy);
  }
  placed.forEach((el, k) => {
    const row = channel.rows[page.first + k];
    if (channel.kind === "lyrics") marks.push({ ...box(el), start: row.start, end: row.end });
    else if (channel.kind === "chords") {
      const bars = el.querySelectorAll(".bar");
      channel.rows[page.first + k].bars.forEach((bar, b) => {
        if (bars[b]) marks.push({ ...box(bars[b]), start: bar.start, end: bar.end });
      });
    } else {
      const chartRow: FigureRow | ScoreRow = channel.rows[page.first + k];
      if (chartRow.type === "figures") {
        const runs = el.querySelectorAll(".figure-run");
        chartRow.items.forEach((run, j) => {
          if (!runs[j]) return;
          // A box over each bar of the run, so the bar playing lights; a bar with no score lights the run.
          const pieces = [...runs[j].querySelectorAll(".bar-piece")];
          let next = 0;
          const bars = run.scoreBars.map((b) => (b !== null && pieces[next] ? box(pieces[next++]) : box(runs[j])));
          marks.push({ ...box(runs[j]), start: run.start, end: run.end, count: run.count, passBeats: run.phraseBeats, bars, barBeats: run.barBeats });
        });
      } else {
        const bars = el.querySelectorAll(".score-bar");
        chartRow.items.forEach((bar, j) => {
          if (bars[j]) marks.push({ ...box(bars[j]), start: bar.start, end: bar.end });
        });
      }
    }
  });
  return marks;
}

/** Put the card before the song on the stage, `height` px tall, for a screenshot. */
function card(doc: RowDocument, song: CardSong, shown: string[], role: string | undefined, height: number): void {
  const s = stage();
  s.innerHTML = "";
  s.className = "card-page";
  s.style.height = `${height}px`;
  const c = cardView(doc, song, shown, role);
  s.appendChild(c);
  fitCard(c);
}

(window as unknown as { einkPage: unknown }).einkPage = { setup, measure, rowHeights, show, card };

