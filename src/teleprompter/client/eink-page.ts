/**
 * The e-ink renderer's page, run in headless Chrome by eink/render.ts: it
 * draws every pane's rows with the prompter's own pane-view (staffs
 * included), then shows one page of one pane at a time for a screenshot and
 * reports where its marks landed.
 */

import type { FigureRow, RowChannel, RowDocument, ScoreRow } from "../rows.js";
import type { Mark } from "../eink/layout.js";
import { channelView, fitRows, type ChannelView } from "./pane-view.js";
import { drawNotation } from "./notation.js";

interface Drawn {
  channel: RowChannel;
  view: ChannelView;
}

let drawn: Drawn[] = [];

const work = () => document.getElementById("work")!;
const stage = () => document.getElementById("stage")!;

/** Draw each channel's rows, and wait for any staffs. */
async function setup(doc: RowDocument): Promise<void> {
  work().innerHTML = "";
  drawn = doc.channels.map((channel) => {
    const view = channelView(channel);
    const pane = document.createElement("div");
    pane.className = `pane pane-${channel.kind}`;
    for (const r of view.rows) pane.appendChild(r.el);
    work().appendChild(pane);
    return { channel, view };
  });
  await Promise.all(
    drawn
      .filter((d) => d.view.notation.length)
      .map((d) => {
        const c = d.channel as Extract<RowChannel, { kind: "figures" | "score" }>;
        return drawNotation(d.view.notation, `/charts/source/${encodeURIComponent(c.id)}`, c.track, c.chart, "rgb(0, 0, 0)");
      }),
  );
  // Notation wider than the screen is scaled down to fit.
  for (const d of drawn) fitRows(d.view);
}

/** The height of the tallest of these pages of pane `i`. */
function measure(i: number, pages: readonly { first: number; last: number }[]): number {
  const rows = drawn[i].view.rows.map((r) => r.el);
  let height = 0;
  for (const p of pages) height = Math.max(height, rows[p.last].offsetTop + rows[p.last].offsetHeight - rows[p.first].offsetTop);
  return height;
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
    const r = el.getBoundingClientRect();
    return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
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
          if (runs[j]) marks.push({ ...box(runs[j]), start: run.start, end: run.end, count: run.count, passBeats: run.phraseBeats });
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

(window as unknown as { einkPage: unknown }).einkPage = { setup, measure, show };
