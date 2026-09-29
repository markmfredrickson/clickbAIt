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

/** One row on a page: a section header or a lyric line. */
export interface Block {
  kind: "section" | "line";
  /** Section start, or the line's first word. */
  beat: number;
  /** When a line's highlight goes dark (lines only). */
  endBeat?: number;
  text: string;
  /** e.g. "Backing Vocal" (lines only). */
  tag?: string;
  /** Section length in bars (headers only). */
  bars?: number;
}

/** A lyric line's place on a rendered page, in CSS px. */
export interface PageLine {
  beat: number;
  endBeat?: number;
  y: number;
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
  /** Parallel to `blocks`. */
  geometry: { y: number; h: number }[];
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
export function blocksFrom(ld: LyricsDisplay): Block[] {
  const bpb = ld.timeSignature?.[0] ?? 4;
  const { words } = ld;
  const { sections, lines } = ld.display;

  // A section runs to the next one. The display data doesn't say where the
  // song ends, so the last section gets no bar count rather than a guess.
  const groups: Block[][] = sections.map((s, i) => {
    const header: Block = { kind: "section", beat: s.startBeat, text: s.name };
    if (i + 1 < sections.length) header.bars = Math.round((sections[i + 1].startBeat - s.startBeat) / bpb);
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
    groups[cur].push(block);
  }
  return groups.flat();
}

/** Turn the browser's pagination into pages with beats and line positions. */
export function assemblePages(blocks: Block[], layout: PageLayout[]): Page[] {
  return layout.map((p) => {
    const onPage = p.blocks.map((i) => blocks[i]);
    const lines: PageLine[] = [];
    onPage.forEach((b, j) => {
      if (b.kind === "line") lines.push({ beat: b.beat, endBeat: b.endBeat, y: p.geometry[j].y, h: p.geometry[j].h });
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
