/**
 * The row document, `<slug>.rows.json`: everything a display can show, laid
 * out once at build as rows, channel by channel. A display picks the
 * channels it wants and shows each in its own pane, in the order asked for.
 * Panes don't line up with each other; each follows the beat on its own, so
 * a drum pane can sit on "A ×8" while the lyrics pane turns several lines.
 *
 * A channel's rows depend on what it is:
 *   lyrics   one row per sung line, its words the items
 *   chords   `barsPerRow` bars per row (4, or the song's or section's own),
 *            never past a section's end; its chords the items
 *   figures  a chart-style part (see charts/figures.ts): one row per
 *            section, its runs of snippets the items ("A ×8"); a section
 *            drawn as a score instead has score rows, as below
 *   score    a score-style part: `barsPerRow` bars per row, like chords,
 *            each bar an item
 *
 * Every row and item has a start and an end in beats, so a display lights
 * whatever contains the beat, and pages by row starts (see panes.ts).
 * Section names are shown only in a display's header, so rows carry the
 * section index at most, never a label to draw.
 *
 * This module is what displays need (it runs in the browser); the build's
 * side is build-rows.ts.
 */

import type { Drawing } from "./drawings.js";
import type { Note } from "./card.js";

export interface Span {
  start: number;
  end: number;
}

export interface RowSection extends Span {
  name: string;
  bars: number;
  beatsPerBar: number;
  /** Each bar's length, when some bars have a meter of their own. */
  barBeats?: number[];
}

export interface Word extends Span {
  text: string;
}

export interface LyricRow extends Span {
  /** e.g. "Backing Vocal". */
  tag?: string;
  items: Word[];
}

export interface ChordItem extends Span {
  chord: string;
}

export interface ChordRow extends Span {
  /** Index into the document's sections. */
  section: number;
  bars: Span[];
  items: ChordItem[];
}

/** How a chart's bars are drawn: the manifest's chart `kind`. */
export type ChartKind = "tab" | "staff" | "staff-tab" | "drums";

export interface FigureItem extends Span {
  /**
   * The snippet's letter (see charts/figures.ts), or null: for bars the song
   * plays only here (drawn) or bars the score has nothing for (not drawn).
   */
  letter: string | null;
  /** The score bar behind each bar of the snippet here. */
  scoreBars: (number | null)[];
  /** Beats in each bar of the snippet. */
  barBeats: number[];
  /** Draw it here: the first time its section plays it. */
  draw: boolean;
  /** Times through, back to back. */
  count: number;
  /** Beats in one time through it. */
  phraseBeats: number;
  /** 1-based song bar the run starts on. */
  songBar: number;
}

export interface FigureRow extends Span {
  type: "figures";
  section: number;
  items: FigureItem[];
}

export interface ScoreBar extends Span {
  songBar: number;
  /** The score bar that plays here, or null where the score has nothing. */
  scoreBar: number | null;
}

export interface ScoreRow extends Span {
  type: "score";
  section: number;
  items: ScoreBar[];
}

/** What every chart channel carries for drawing its notation. */
interface ChartChannel {
  id: string;
  instrument: string;
  chart: ChartKind;
  /** The score file, relative to the song folder, and the track in it. */
  source: string;
  track: number;
}

export type RowChannel =
  | { id: string; kind: "lyrics"; rows: LyricRow[] }
  | { id: string; kind: "chords"; rows: ChordRow[] }
  // A chart-style part: figure rows, with score rows for the sections drawn bar by bar.
  | (ChartChannel & { kind: "figures"; rows: (FigureRow | ScoreRow)[] })
  | (ChartChannel & { kind: "score"; rows: ScoreRow[] });

export interface RowDocument {
  schema: "clickbait/rows@1";
  slug: string;
  title: string;
  sections: RowSection[];
  channels: RowChannel[];
  /** Chart channels' notation, drawn at build: by channel id, then drawingKey. */
  notation?: Record<string, Record<string, Drawing>>;
  /** What the card before the song shows (see card.ts). */
  card?: {
    /** Where the song's timeline starts (the lead-in's first beat): the card shows there. */
    startBeat: number;
    notes: Note[];
    /** A chart-style part's snippets, a reminder of what it plays: each letter with its score bars, rests left out. */
    figures: Record<string, { letter: string; scoreBars: number[] }[]>;
    /** A score-style part's opening: its first row and bar that plays (not only rests). */
    opening: Record<string, { row: number; item: number }>;
  };
}

/**
 * The channel ids a list of names asks for, in that order: each name is a
 * channel's id or an instrument, which stands for every chart of it
 * ("guitar"). Names the song doesn't have are left out.
 */
export function resolveChannels(doc: RowDocument, names: readonly string[]): string[] {
  const ids: string[] = [];
  for (const name of names) {
    for (const c of doc.channels) {
      const chart = c.kind === "figures" || c.kind === "score";
      if ((c.id === name || (chart && c.instrument === name)) && !ids.includes(c.id)) ids.push(c.id);
    }
  }
  return ids;
}

/** The document with only the channels `ids` names, in that order. */
export function selectChannels(doc: RowDocument, ids: readonly string[]): RowDocument {
  const channels = ids.flatMap((id) => doc.channels.filter((c) => c.id === id));
  return { ...doc, channels };
}

export interface ChannelPosition {
  /** The last row started, or -1 before the first. */
  row: number;
  /** The item in it playing now, or -1. */
  item: number;
  /** Figure runs: which time through the phrase this is, of how many. */
  pass?: number;
  of?: number;
}

/** Where each channel is at `beat`, by channel id. */
export function itemsAt(doc: RowDocument, beat: number): Record<string, ChannelPosition> {
  const out: Record<string, ChannelPosition> = {};
  for (const channel of doc.channels) {
    const rows: (Span & { items: Span[] })[] = channel.rows;
    let row = -1;
    for (let r = 0; r < rows.length && rows[r].start <= beat; r++) row = r;
    const pos: ChannelPosition = { row, item: -1 };
    if (row >= 0) {
      const items = rows[row].items;
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].start <= beat && beat < items[i].end) {
          pos.item = i;
          break;
        }
      }
      const chartRow = channel.kind === "figures" ? channel.rows[row] : null;
      if (chartRow?.type === "figures" && pos.item >= 0) {
        const run = chartRow.items[pos.item];
        pos.pass = Math.floor((beat - run.start) / run.phraseBeats) + 1;
        pos.of = run.count;
      }
    }
    out[channel.id] = pos;
  }
  return out;
}

const DRAWN_AS: Record<ChartKind, string> = { tab: "tab", staff: "notation", "staff-tab": "notation + tab", drums: "" };

/** A channel's name on a display: "Lyrics", "Chords", or its part ("Rhythm guitar"). */
export function channelName(c: RowChannel): string {
  if (c.kind === "lyrics") return "Lyrics";
  if (c.kind === "chords") return "Chords";
  const name = c.id.replace(/-/g, " ");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The name and, for a part, how it's drawn, for a pane's label: "Rhythm guitar · tab". */
export function channelTitle(c: RowChannel): string {
  const drawn = c.kind === "figures" || c.kind === "score" ? DRAWN_AS[c.chart] : "";
  return drawn ? `${channelName(c)} · ${drawn}` : channelName(c);
}
