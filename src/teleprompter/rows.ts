/**
 * The row document, `<slug>.rows.json`: everything a display can show, laid
 * out once at build as rows, channel by channel. A display picks the
 * channels it wants and shows each in its own pane, in the order asked for.
 * Panes don't line up with each other; each follows the beat on its own, so
 * a drum pane can sit on "A ×8" while the lyrics pane turns several lines.
 *
 * A channel's rows depend on what it is:
 *   lyrics  one row per sung line, its words the items
 *   chords  `barsPerRow` bars per row (4, or the song's or section's own),
 *           never past a section's end; its chords the items
 *   drums   one row per section; its groove runs the items, each run whole
 *
 * Every row and item has a start and an end in beats, so a display lights
 * whatever contains the beat, and pages by row starts (see panes.ts).
 * Section names are shown only in a display's header, so rows carry the
 * section index at most, never a label to draw.
 *
 * This module is what displays need (it runs in the browser); the build's
 * side is build-rows.ts.
 */


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

export interface DrumItem extends Span {
  /** The groove's letter, or null for bars the score has nothing for. */
  letter: string | null;
  /** Bars in the run. */
  count: number;
  /** Beats in each of its bars. */
  barBeats: number;
  /** 1-based song bar the run starts on. */
  songBar: number;
  /** The score bar that shows the groove, or null. */
  scoreBar: number | null;
  /** True on the run where its section first plays the letter: draw the notation here. */
  first: boolean;
}

export interface DrumRow extends Span {
  section: number;
  items: DrumItem[];
}

export type RowChannel =
  | { id: string; kind: "lyrics"; rows: LyricRow[] }
  | { id: string; kind: "chords"; rows: ChordRow[] }
  | { id: string; kind: "drums"; instrument: string; source: string; track: number; rows: DrumRow[] };

export interface RowDocument {
  schema: "clickbait/rows@1";
  slug: string;
  title: string;
  sections: RowSection[];
  channels: RowChannel[];
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
  /** Drum runs: which bar of the run this is, of how many. */
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
      if (channel.kind === "drums" && pos.item >= 0) {
        const run = channel.rows[row].items[pos.item];
        pos.pass = Math.floor((beat - run.start) / run.barBeats) + 1;
        pos.of = run.count;
      }
    }
    out[channel.id] = pos;
  }
  return out;
}
