/**
 * One channel of a song on a static page, to pass around or print: the card
 * a screen showing only this channel would show, then all of its rows, each
 * under its section's name. Nothing plays and nothing turns. The page's data
 * comes inlined (see sheets.ts).
 */

import type { RowDocument } from "../rows.js";
import { cardView, fitCard, type CardSong } from "./card-view.js";
import { channelView, fitRows, groupBars, placeNotation } from "./pane-view.js";

declare global {
  interface Window {
    __SHEET__: { doc: RowDocument; song: CardSong; channel: string };
  }
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

const { doc, song, channel: id } = window.__SHEET__;
const channel = doc.channels.find((c) => c.id === id)!;
const root = document.getElementById("sheet")!;

// The card's title, facts and notes, with no current item marked.
const card = cardView({ ...doc, card: doc.card && { ...doc.card, opening: {} } }, song, [id]);
root.appendChild(card);

const view = channelView(channel);
const pane = el("section", "pane pane-" + channel.kind);
// Rows that know their section (charts, chords) get its name when it changes.
let last = -1;
view.rows.forEach((r, i) => {
  const row = channel.rows[i];
  if ("section" in row && row.section !== last) {
    last = row.section;
    pane.appendChild(el("div", "sheet-section", doc.sections[row.section]?.name ?? ""));
  }
  pane.appendChild(r.el);
});
root.appendChild(pane);
placeNotation(view, doc.notation?.[id] ?? {});

function fit() {
  fitCard(card);
  fitRows(view);
  groupBars(view);
}
fit();
window.addEventListener("resize", fit);
