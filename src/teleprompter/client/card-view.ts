/**
 * The card before a song, as page elements, for the web prompter and the
 * e-ink renderer alike: the song, its key and tempo, this screen's notes
 * (see card.ts), and for each part on screen a reminder of what it plays:
 * a chart-style part's figures, each letter with its bar, or a score-style
 * part's opening row, drawn with the notation the rows carry.
 */

import type { FigureRow, RowChannel, RowDocument, ScoreRow } from "../rows.js";
import { channelTitle } from "../rows.js";
import { notesFor } from "../card.js";
import { drawingKey } from "../drawings.js";
import { channelView, fitRow, placeDrawing } from "./pane-view.js";

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

  const channels = shown.flatMap((id) => doc.channels.filter((c) => c.id === id));
  for (const note of notesFor(doc.card?.notes ?? [], channels, role)) {
    const n = el("div", "card-note" + (note.for === "banter" ? " banter" : ""));
    if (note.for !== "all") n.appendChild(el("div", "card-note-for", note.for));
    n.appendChild(el("div", "card-note-text", note.text));
    card.appendChild(n);
  }

  for (const channel of channels) {
    const figure = legendRow(channel, doc) ?? openingRow(channel, doc.card?.opening[channel.id]);
    if (!figure) continue;
    const part = el("div", `card-figure pane-${channel.kind}`);
    part.appendChild(el("div", "card-figure-for", channelTitle(channel)));
    const view = channelView(figure);
    const drawn = doc.notation?.[channel.id] ?? {};
    for (const t of view.notation) {
      const d = drawn[drawingKey(t.start, t.count)];
      if (d) placeDrawing(t, d, d.svg);
    }
    part.appendChild(view.rows[0].el);
    card.appendChild(part);
  }
  return card;
}

/** Scale down any of the card's figures too wide for it, once it's on the page. */
export function fitCard(card: HTMLElement): void {
  card.querySelectorAll<HTMLElement>(".card-figure > .row").forEach(fitRow);
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

/** A one-row channel of a chart-style part's figures: "(A) [bar] (B) [bar] …". */
function legendRow(channel: RowChannel, doc: RowDocument): RowChannel | null {
  const list = doc.card?.figures?.[channel.id];
  if (channel.kind !== "figures" || !list?.length) return null;
  const items = list.map((f) => ({
    letter: f.letter, scoreBars: f.scoreBars, barBeats: f.scoreBars.map(() => 0), draw: true, count: 1, phraseBeats: 0, songBar: 0, start: 0, end: 0,
  }));
  return { ...channel, rows: [{ type: "figures", section: 0, start: 0, end: 0, items }] };
}
