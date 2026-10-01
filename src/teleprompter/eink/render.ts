/**
 * Render a song's panes into fixed-size page PNGs for an e-ink screen, in
 * headless Chrome at the device's exact CSS size and pixel ratio.
 *
 * The page is the prompter's own pane-view (client/eink-page.ts) with e-ink
 * styles, served to Chrome from a private origin along with the music font,
 * so chart panes show the notation the rows carry. Panes are fitted top to
 * bottom: each shows the rows asked for, or fewer if they don't fit, and the
 * last pane, unless told otherwise, as many as fit.
 *
 * Uses the system Chrome through Playwright, loaded only when an e-ink client
 * first asks for pages, so the relay runs fine without either.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { channelTitle, type RowDocument } from "../rows.js";
import { panePages } from "../panes.js";
import { clientDir } from "../build-client.js";
import { ALPHATAB_DIR, ALPHATAB_FILES, FONT } from "../alphatab-files.js";
import { notationCss } from "../../charts/notation-svg.js";
import type { EinkPane, Mark } from "./layout.js";
import type { CardSong } from "../client/card-view.js";

export interface RenderSize {
  /** CSS px. */
  width: number;
  height: number;
  /** Device pixel ratio; PNGs are width*dpr × height*dpr. */
  dpr: number;
  /** Base font size in CSS px. Default: height / 22. */
  fontPx?: number;
}

export interface RenderOptions {
  /** Rows per pane, by channel id; a pane not listed takes its kind's default. */
  rows?: Record<string, number>;
  /** The card before the song: the song's facts, and the screen's role for its notes. */
  card?: { song: CardSong; role?: string };
}

/** A rendered deck, before the relay gives its images their URLs. */
export interface Rendered {
  panes: RenderedPane[];
  /** The card's image, when the rows have a card. */
  card: string | null;
}

/** A rendered pane, before the relay gives its pages their URLs. */
export type RenderedPane = Omit<EinkPane, "pages"> & { pages: { start: number; file: string; marks: Mark[] }[] };

/** Rows a pane shows when the page doesn't say: a little of a chart above, the rest for words. */
const DEFAULT_ROWS = { lyrics: 8, chords: 3, figures: 2, score: 2 };

type Chromium = { launch(opts: { channel: string }): Promise<any> };

async function chromium(): Promise<Chromium> {
  try {
    const pw = await import("@playwright/test");
    return pw.chromium as Chromium;
  } catch {
    throw new Error("e-ink rendering needs Playwright (npm install) and Google Chrome");
  }
}

/** True when headless Chrome can be launched here. */
export async function chromeAvailable(): Promise<boolean> {
  try {
    const browser = await (await chromium()).launch({ channel: "chrome" });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

const ORIGIN = "http://eink.local";

function pageHtml(size: Required<RenderSize>): string {
  const f = size.fontPx;
  // Tight margins: e-ink pixels are scarce, and the playing line is marked by
  // inverting it, so no gutter is needed for a marker.
  const pad = Math.round(f * 0.3);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${notationCss(FONT)}</style><style>
    html, body { margin: 0; background: #fff; color: #000; }
    body { font: ${f}px/1.25 "Helvetica Neue", Arial, sans-serif; }
    #work { position: absolute; left: 0; top: 0; width: ${size.width}px; visibility: hidden; }
    #stage { position: absolute; left: 0; top: 0; width: ${size.width}px; overflow: hidden; background: #fff; }
    .pane { box-sizing: border-box; padding: 0 ${pad}px; }
    .pane.ruled { border-bottom: 3px solid #000; }
    .row { padding: ${Math.round(f * 0.1)}px 0; }
    .pane-chords { font-size: 0.85em; }
    .pane-figures, .pane-score { font-size: 0.75em; }
    .bv { font-style: italic; color: #333; }
    .chord-row { display: flex; }
    .chord-row .bar { display: grid; flex-basis: 0; align-items: center; border-left: 2px solid #000; padding: 0 ${Math.round(f * 0.15)}px; }
    .chord-row .bar.end { border-right: 2px solid #000; }
    .chord-row .pad { flex-basis: 0; }
    .chord { grid-row: 1; font-weight: 700; white-space: nowrap; padding-right: 0.3em; }
    .chord.held { font-weight: 400; color: #666; }
    .figure-row, .score-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.3em 1em; padding-bottom: ${Math.round(f * 0.25)}px; }
    .figure-run, .figure-body { display: inline-flex; align-items: center; gap: 0.4em; }
    .figure-label { font-size: 1.5em; font-weight: 700; white-space: nowrap; }
    .figure-label.paren { font-weight: 400; font-size: 2em; }
    .figure-count:empty { display: none; }
    .score-seg { position: relative; }
    .score-seg.empty { display: flex; gap: 0.6em; }
    .score-bar { position: absolute; top: 0; bottom: 0; display: none; }
    .score-bar.blank { position: static; display: inline-block; min-width: 3em; text-align: center; font-size: 1.5em; color: #666; }
    .notation { min-width: 4rem; zoom: calc(${((f * 0.75 * 1.1) / 19.2).toFixed(3)} * var(--fit, 1)); }
    .notation:empty { display: none; }
    .card-page { box-sizing: border-box; padding: ${pad * 2}px; }
    .card-title { font-size: 1.5em; font-weight: 700; }
    .card-facts { color: #444; margin-bottom: ${pad * 2}px; }
    .card-note { margin: ${pad}px 0; white-space: pre-wrap; }
    .card-note.banter .card-note-text { font-style: italic; }
    .card-note-for, .card-figure-for { font-size: 0.55em; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
    .card-figure { margin-top: ${pad * 2}px; font-size: 0.75em; }
  </style></head><body><div id="work"></div><div id="stage"></div><script src="/eink-page.js"></script></body></html>`;
}

/**
 * Render `doc`'s channels (in order, one pane each) into
 * `outDir/<pane>-<page>.png` and return where the panes and their marks are.
 */
export async function renderPanes(doc: RowDocument, size: RenderSize, outDir: string, opts: RenderOptions = {}): Promise<Rendered> {
  const full: Required<RenderSize> = { ...size, fontPx: size.fontPx ?? Math.round(size.height / 22) };
  const browser = await (await chromium()).launch({ channel: "chrome" });
  try {
    const page = await browser.newPage({
      viewport: { width: full.width, height: full.height },
      deviceScaleFactor: full.dpr,
    });
    // The page, its script, alphaTab and the scores, from a private origin.
    await page.route(`${ORIGIN}/**`, async (route: any) => {
      const path = new URL(route.request().url()).pathname;
      const send = (body: Uint8Array | string, contentType: string) => route.fulfill({ status: 200, body: Buffer.from(body), contentType });
      if (path === "/") return send(pageHtml(full), "text/html");
      if (path === "/eink-page.js") return send(readFileSync(join(clientDir, "eink-page.js")), "application/javascript");
      const vendor = path.match(/^\/vendor\/alphatab\/(.+)$/);
      if (vendor && ALPHATAB_FILES[vendor[1]]) return send(readFileSync(join(ALPHATAB_DIR, vendor[1])), ALPHATAB_FILES[vendor[1]]);
      return route.fulfill({ status: 404, body: "" });
    });
    await page.goto(`${ORIGIN}/`);
    await page.evaluate((d: RowDocument) => (window as any).einkPage.setup(d), doc);

    const measureRows = (i: number, k: number) => {
      const pages = panePages(doc.channels[i].rows, k);
      return page.evaluate(([n, p]: [number, typeof pages]) => (window as any).einkPage.measure(n, p), [i, pages] as [number, typeof pages]) as Promise<number>;
    };
    // Every pane gets at least one row: what each needs for that is held back
    // from the panes above it.
    const oneRow: number[] = [];
    for (let i = 0; i < doc.channels.length; i++) oneRow.push(Math.ceil(await measureRows(i, 1)) + 3);

    const panes: RenderedPane[] = [];
    let left = full.height;
    for (let i = 0; i < doc.channels.length; i++) {
      const channel = doc.channels[i];
      const last = i === doc.channels.length - 1;
      const asked = opts.rows?.[channel.id];
      const room = left - oneRow.slice(i + 1).reduce((sum, h) => sum + h, 0);
      const measure = (k: number) => measureRows(i, k);
      // Rows for this pane: as asked (or its default), fewer if that doesn't
      // fit; the last pane, not told, as many as fit.
      let k = Math.max(1, Math.min(asked ?? DEFAULT_ROWS[channel.kind], channel.rows.length || 1));
      if (last && asked === undefined) {
        k = 1;
        while (k < channel.rows.length && (await measure(k + 1)) + 3 <= room) k++;
      }
      let height = await measure(k);
      while (k > 1 && height + 3 > room) height = await measure(--k);
      height = Math.min(Math.max(1, Math.ceil(height) + (last ? 0 : 3)), Math.max(1, room));

      const pages = panePages(channel.rows, k);
      const out: RenderedPane["pages"] = [];
      for (let j = 0; j < pages.length; j++) {
        const marks: Mark[] = await page.evaluate(
          ([n, p, h, l]: [number, (typeof pages)[number], number, boolean]) => (window as any).einkPage.show(n, p, h, l),
          [i, pages[j], height, last] as [number, (typeof pages)[number], number, boolean],
        );
        const file = `${i}-${j}.png`;
        await page.locator("#stage").screenshot({ path: join(outDir, file) });
        out.push({ start: pages[j].start, file, marks });
      }
      panes.push({ id: channel.id, kind: channel.kind, title: channelTitle(channel), top: full.height - left, height, pages: out });
      left -= height;
    }
    // The card before the song, a page of its own.
    let card: string | null = null;
    if (doc.card && opts.card) {
      await page.evaluate(
        ([d, song, shown, role, h]: [RowDocument, CardSong, string[], string | undefined, number]) => (window as any).einkPage.card(d, song, shown, role, h),
        [doc, opts.card.song, doc.channels.map((c) => c.id), opts.card.role, full.height] as [RowDocument, CardSong, string[], string | undefined, number],
      );
      card = "card.png";
      await page.locator("#stage").screenshot({ path: join(outDir, card) });
    }
    return { panes, card };
  } finally {
    await browser.close();
  }
}
