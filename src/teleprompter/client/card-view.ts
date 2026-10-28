/**
 * The card before a song, as page elements, for the web prompter and the
 * e-ink renderer alike: the song, its key and tempo, its form (each section
 * and its bars), this screen's notes (see card.ts), and for each part on
 * screen a reminder of what it plays: its opening (a chart-style part's first
 * run, a score-style part's first row), drawn with the notation the rows carry.
 */

import type { FigureRow, RowChannel, RowDocument, ScoreRow } from "../rows.js";
import { channelTitle } from "../rows.js";
import { notesFor, songForm } from "../card.js";
import { channelView, fitTogether, placeNotation } from "./pane-view.js";

export interface CardSong {
  title: string;
  artist?: string;
  key?: string;
  bpm?: number;
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** The card for a screen showing `shown` channels (ids, in order), for `role` if it has one. */
export function cardView(doc: RowDocument, song: CardSong, shown: readonly string[], role?: string): HTMLElement {
  const card = el("div", "card");
  card.appendChild(el("div", "card-title", song.title));
  const facts = [song.artist, song.key ? `Key: ${song.key}` : undefined, song.bpm ? `${Math.round(song.bpm)} BPM` : undefined].filter(Boolean);
  if (facts.length) card.appendChild(el("div", "card-facts", facts.join(" · ")));

  const form = songForm(doc.sections);
  if (form.length) {
    const list = card.appendChild(el("div", "card-form"));
    for (const s of form) {
      const item = list.appendChild(el("span", "card-section", s.name));
      item.appendChild(el("span", "card-section-bars", String(s.bars)));
    }
  }

  const channels = shown.flatMap((id) => doc.channels.filter((c) => c.id === id));
  for (const note of notesFor(doc.card?.notes ?? [], channels, role)) {
    const n = el("div", "card-note" + (note.for === "banter" ? " banter" : ""));
    if (note.for !== "all") n.appendChild(el("div", "card-note-for", note.for));
    n.appendChild(el("div", "card-note-text", note.text));
    card.appendChild(n);
  }

  for (const channel of channels) {
    const figure = openingRow(channel, doc.card?.opening[channel.id]);
    if (!figure) continue;
    const part = el("div", `card-figure pane-${channel.kind}`);
    part.appendChild(el("div", "card-figure-for", channelTitle(channel)));
    const view = channelView(figure);
    placeNotation(view, doc.notation?.[channel.id] ?? {});
    part.appendChild(view.rows[0].el);
    card.appendChild(part);
  }
  return card;
}

/** Scale down the card's figures, all to one size, to fit it once it's on the page. */
export function fitCard(card: HTMLElement): void {
  fitTogether([...card.querySelectorAll<HTMLElement>(".card-figure > .row")]);
}

/**
 * A one-row channel holding a part's opening figure: the run alone for a
 * figure row, the whole row for a score row (its bars read together).
 */
function openingRow(channel: RowChannel, at: { row: number; item: number } | undefined): RowChannel | null {
  if (!at || (channel.kind !== "figures" && channel.kind !== "score")) return null;
  const row: FigureRow | ScoreRow | undefined = channel.rows[at.row];
  if (!row) return null;
  const only: FigureRow | ScoreRow = row.type === "figures" ? { ...row, items: [{ ...row.items[at.item], count: 1 }] } : row;
  return { ...channel, kind: "figures", rows: [only] };
}
