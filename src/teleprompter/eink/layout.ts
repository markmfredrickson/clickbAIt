/**
 * E-ink page layout: the parts shared by the relay (which renders pages) and
 * the e-ink client (which picks the page and line for the current beat).
 *
 * E-ink browsers (the Kindle's included) re-scale and re-flow pages on their
 * own, so the relay lays the song out in headless Chrome at the device's exact
 * size and hands over images. This module holds the pure pieces: what goes on
 * the pages, where each page starts in beats, and which page/line a beat
 * selects. Chrome-specific work lives in render.ts.
 */

import type { LyricsDisplay } from "../lyrics-display.js";
import { layoutChords, rowLines, BARS_PER_LINE, type LayoutInput } from "../../charts/chord-layout.js";

/** The song's chords, as the relay's /charts/chords sends them. */
export interface EinkChords {
  sections: LayoutInput["sections"];
  chords: LayoutInput["chords"];
}

/** What a page shows: lyrics or not, and chords when the song has them. */
export interface EinkView {
  lyrics?: boolean;
  chords?: EinkChords | null;
}

/** One row on a page: a section header, a lyric line, or a row of chord bars. */
export interface Block {
  kind: "section" | "line" | "chords";
  /** Section start, the line's first word, or the row's first chord. */
  beat: number;
  /** When a line's highlight goes dark (lines only). */
  endBeat?: number;
  text: string;
  /** e.g. "Backing Vocal" (lines only). */
  tag?: string;
  /** Section length in bars (headers only). */
  bars?: number;
  /** A line's words, each with the chord over it, when chords are shown. */
  words?: { text: string; chord?: string }[];
  /** A chord row's bars: each chord and where it falls in its bar (0 to 1). */
  chordBars?: ChordBar[];
  /** Beats a full chord line holds (four of the song's bars), so short lines line up. */
  lineBeats?: number;
}

export interface ChordBar {
  startBeat: number;
  beats: number;
  chords: { chord: string; at: number }[];
}

/**
 * Something to highlight on a rendered page, in CSS px: a lyric line (full
 * width), or one bar of a chord row (with its own x and width).
 */
export interface PageLine {
  beat: number;
  endBeat?: number;
  x?: number;
  y: number;
  w?: number;
  h: number;
}

export interface Page {
  /** Earliest beat on the page (a pickup line can start before its header). */
  startBeat: number;
  lines: PageLine[];
}

/** What the browser reports after paginating: block indices per page and where each landed. */
export interface PageLayout {
  blocks: number[];
  /** Parallel to `blocks`. A chord row also reports each bar's box. */
  geometry: { y: number; h: number; bars?: { x: number; y: number; w: number; h: number }[] }[];
}

// A line's highlight releases like the lyrics display's word highlight: the
// last word is held 1–3 beats (the aligner's end times can stretch into the
// silence after a phrase), plus a half-beat grace.
const HOLD_MIN = 1;
const HOLD_MAX = 3;
const HOLD_GRACE = 0.5;

/**
 * Flatten a song into blocks: each section header followed by its lines.
 *
 * Lines are grouped by their own `section` label, not by beat — a line with a
 * pickup starts before its section's downbeat and would otherwise land at the
 * end of the previous section. Section names repeat (Chorus ×3), so the walk
 * only moves forward: a line stays in the current section while the name
 * matches, else moves to the next section with its name. An unlabelled line
 * goes to the section its beat falls in.
 */
export function blocksFrom(ld: LyricsDisplay, view: EinkView = {}): Block[] {
  const bpb = ld.timeSignature?.[0] ?? 4;
  const { words } = ld;
  const { sections } = ld.display;
  const showLyrics = view.lyrics !== false;
  const lines = showLyrics ? ld.display.lines : [];
  const chords = view.chords ?? null;
  // The same chord layout as the web prompter: over words where sung, else rows.
  const layout = chords
    ? layoutChords({ sections: chords.sections, words: showLyrics ? words : [], lines, chords: chords.chords })
    : null;

  // Bar counts come from the manifest. Files built before they were recorded
  // fall back to measuring to the next section, and the last section of such
  // a file gets no count rather than a guess.
  const groups: Block[][] = sections.map((s, i) => {
    const header: Block = { kind: "section", beat: s.startBeat, text: s.name };
    if (s.bars !== undefined) header.bars = s.bars;
    else if (i + 1 < sections.length) header.bars = Math.round((sections[i + 1].startBeat - s.startBeat) / bpb);
    return [header];
  });

  let cur = 0;
  for (const l of lines) {
    const ws = words.slice(l.words[0], l.words[1] + 1);
    if (!ws.length || !groups.length) continue;
    const beat = ws[0].startBeat;
    if (l.section) {
      if (sections[cur].name !== l.section) {
        const next = sections.findIndex((s, i) => i > cur && s.name === l.section);
        if (next >= 0) cur = next;
      }
    } else {
      while (cur + 1 < sections.length && sections[cur + 1].startBeat <= beat) cur++;
    }
    const last = ws[ws.length - 1];
    const hold = Math.min(HOLD_MAX, Math.max(HOLD_MIN, last.endBeat - last.startBeat));
    const block: Block = { kind: "line", beat, endBeat: last.startBeat + hold + HOLD_GRACE, text: ws.map((w) => w.text).join(" ") };
    if (l.tag) block.tag = l.tag;
    if (layout && chords) {
      block.words = ws.map((w, k) => {
        const c = layout.overWord[l.words[0] + k];
        return c === undefined ? { text: w.text } : { text: w.text, chord: chords.chords[c].chord };
      });
    }
    groups[cur].push(block);
  }
  const blocks = groups.flat();
  if (!layout || !chords) return blocks;

  // Chord rows go in beat order: before the first block that comes later, so
  // a row that starts a section lands just after that section's header. A
  // long row is broken into lines of four bars, each a block of its own.
  let from = 0;
  for (const row of layout.rows) {
    let at = blocks.findIndex((b, i) => i >= from && b.beat > row.firstBeat + 1e-6);
    if (at < 0) at = blocks.length;
    const bars: ChordBar[] = row.bars.map((bar) => ({
      startBeat: bar.startBeat,
      beats: bar.beats,
      chords: bar.chords.map((c) => ({ chord: chords.chords[c.chord].chord, at: c.at })),
    }));
    const lines: Block[] = rowLines(bars).map((line, k) => ({
      kind: "chords" as const,
      beat: k === 0 ? row.firstBeat : line[0].startBeat,
      text: "",
      chordBars: line,
      lineBeats: BARS_PER_LINE * bpb,
    }));
    blocks.splice(at, 0, ...lines);
    from = at + lines.length;
  }
  return blocks;
}

/** Turn the browser's pagination into pages with beats and line positions. */
export function assemblePages(blocks: Block[], layout: PageLayout[]): Page[] {
  return layout.map((p) => {
    const onPage = p.blocks.map((i) => blocks[i]);
    const lines: PageLine[] = [];
    onPage.forEach((b, j) => {
      const g = p.geometry[j];
      if (b.kind === "line") lines.push({ beat: b.beat, endBeat: b.endBeat, y: g.y, h: g.h });
      // Each bar of a chord row lights on its own, while it plays.
      if (b.kind === "chords") {
        (b.chordBars ?? []).forEach((bar, k) => {
          const box = g.bars?.[k];
          if (box) lines.push({ beat: bar.startBeat, endBeat: bar.startBeat + bar.beats, x: box.x, y: box.y, w: box.w, h: box.h });
        });
      }
    });
    return { startBeat: onPage.length ? Math.min(...onPage.map((b) => b.beat)) : 0, lines };
  });
}

/**
 * The page to show at `beat`: the last page whose first beat is within
 * `leadBeats`. Turning early gives the reader the next page before its first
 * line is sung.
 */
export function pageAt(pages: readonly { startBeat: number }[], beat: number, leadBeats: number): number {
  let page = 0;
  for (let i = 1; i < pages.length; i++) if (beat >= pages[i].startBeat - leadBeats) page = i;
  return page;
}

/**
 * The line to highlight at `beat` (index into `lines`), or -1 for none. A line
 * lights `lookahead` beats early and goes dark at its `endBeat`, so nothing
 * stays lit through a solo.
 */
export function lineAt(lines: readonly { beat: number; endBeat?: number }[], beat: number, lookahead: number): number {
  let line = -1;
  for (let i = 0; i < lines.length; i++) if (lines[i].beat <= beat + lookahead) line = i;
  const end = line >= 0 ? lines[line].endBeat : undefined;
  return end !== undefined && beat >= end ? -1 : line;
}
