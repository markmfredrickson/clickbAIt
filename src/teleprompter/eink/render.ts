/**
 * Render a song into fixed-size page PNGs for an e-ink screen, in headless
 * Chrome at the device's exact CSS size and pixel ratio.
 *
 * Uses the system Chrome through Playwright, loaded only when an e-ink client
 * first asks for pages, so the relay runs fine without either.
 */

import { join } from "node:path";
import type { LyricsDisplay } from "../lyrics-display.js";
import { assemblePages, blocksFrom, type Block, type EinkView, type Page, type PageLayout } from "./layout.js";
import { barGrid } from "../../charts/chord-layout.js";

export interface RenderSize {
  /** CSS px. */
  width: number;
  height: number;
  /** Device pixel ratio; PNGs are width*dpr × height*dpr. */
  dpr: number;
  /** Base font size in CSS px. Default: height / 22. */
  fontPx?: number;
}

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

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The page document: all blocks in a hidden flow, plus a paginate() that moves
 * them into fixed-height pages and reports the layout. A section header never
 * ends a page; it moves down with the line after it.
 */
function pageHtml(blocks: Block[], title: string, size: Required<RenderSize>): string {
  const f = size.fontPx;
  // Tight margins: e-ink pixels are scarce, and the current line is marked by
  // inverting it, so no gutter is needed for a marker.
  const pad = Math.round(f * 0.3);
  const footRoom = Math.round(f * 0.55);
  const flow = blocks
    .map((b, i) => {
      if (b.kind === "section") {
        return `<div class="blk sec" data-i="${i}"><span>${esc(b.text)}</span><em>${b.bars !== undefined ? `${b.bars} bar${b.bars === 1 ? "" : "s"}` : ""}</em></div>`;
      }
      if (b.kind === "chords") {
        // One line of bars, as wide as the page, each bar's share set by its
        // beats. A short last line is padded so its bars line up with the
        // lines above.
        const line = b.chordBars ?? [];
        const bars = line
          .map((bar, k) => {
            const grid = barGrid(bar);
            const cs = bar.chords.map((c, j) => `<b style="grid-column-start:${grid.starts[j]}">${esc(c.chord)}</b>`).join("");
            const end = k === line.length - 1 ? " end" : "";
            return `<div class="bar${end}" style="flex-grow:${bar.beats};grid-template-columns:repeat(${grid.columns},1fr)">${cs}</div>`;
          })
          .join("");
        const room = (b.lineBeats ?? 0) - line.reduce((sum, bar) => sum + bar.beats, 0);
        const pad = room > 0 ? `<div class="pad" style="flex-grow:${room}"></div>` : "";
        return `<div class="blk crow" data-i="${i}">${bars}${pad}</div>`;
      }
      // A line with chords: each word a column, chord slot on top, so the text stays level.
      const text = b.words
        ? b.words.map((w) => `<span class="w"><b>${w.chord ? esc(w.chord) : "&nbsp;"}</b>${esc(w.text)}</span>`).join(" ")
        : esc(b.text);
      return `<div class="blk line${b.tag && /backing/i.test(b.tag) ? " bv" : ""}" data-i="${i}">${text}</div>`;
    })
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; background: #fff; color: #000; }
    body { font: ${f}px/1.25 "Helvetica Neue", Arial, sans-serif; }
    .page { width: ${size.width}px; height: ${size.height}px; overflow: hidden; box-sizing: border-box;
            padding: ${pad}px; position: relative; background: #fff; }
    .foot { position: absolute; right: ${pad}px; bottom: ${Math.round(pad / 3)}px; font-size: ${Math.round(f * 0.45)}px; color: #555; }
    .sec { display: flex; justify-content: space-between; align-items: baseline; font-weight: 700;
           text-transform: uppercase; border-top: 3px solid #000; margin-top: ${Math.round(f * 0.5)}px;
           padding-top: ${Math.round(f * 0.15)}px; font-size: ${Math.round(f * 0.75)}px; }
    .sec em { font-style: normal; font-weight: 400; }
    .page > .blk:first-child.sec { margin-top: 0; }
    .line { margin: ${Math.round(f * 0.12)}px 0; }
    .bv { font-style: italic; color: #333; }
    .w { display: inline-flex; flex-direction: column; vertical-align: bottom; line-height: 1.1; }
    .w b { font-size: 0.7em; font-weight: 700; white-space: nowrap; }
    .crow b { font-weight: 700; white-space: nowrap; padding-right: 0.3em; }
    .crow { font-size: 0.7em; display: flex; margin: ${Math.round(f * 0.12)}px 0; }
    .crow .bar { display: grid; flex-basis: 0; border-left: 2px solid #000; padding: 0 ${Math.round(f * 0.15)}px; }
    .crow .bar.end { border-right: 2px solid #000; }
    .crow .pad { flex-basis: 0; }
    #flow { display: none; }
  </style></head><body><div id="flow">${flow}</div><div id="pages"></div><script>
    function paginate() {
      var blocks = Array.prototype.slice.call(document.querySelectorAll('#flow > .blk'));
      var host = document.getElementById('pages');
      var pages = [];
      function newPage() { var p = document.createElement('div'); p.className = 'page'; host.appendChild(p); pages.push(p); return p; }
      function fits(p) {
        var last = p.lastElementChild;
        return last.offsetTop + last.offsetHeight <= p.clientHeight - ${pad} - ${footRoom};
      }
      var cur = newPage();
      blocks.forEach(function (b) {
        cur.appendChild(b);
        if (fits(cur) || cur.children.length === 1) return;
        var moved = [b];
        var prev = b.previousElementSibling;
        if (prev && prev.classList.contains('sec') && cur.children.length > 2) moved.unshift(prev);
        cur = newPage();
        moved.forEach(function (m) { cur.appendChild(m); });
      });
      return pages.map(function (p, i) {
        var kids = Array.prototype.slice.call(p.querySelectorAll('.blk'));
        var foot = document.createElement('div');
        foot.className = 'foot';
        foot.textContent = ${JSON.stringify(title)} + '  ·  ' + (i + 1) + '/' + pages.length;
        p.appendChild(foot);
        return {
          blocks: kids.map(function (k) { return +k.dataset.i; }),
          geometry: kids.map(function (k) {
            var g = { y: k.offsetTop, h: k.offsetHeight };
            // A chord row also reports each bar, so each can be highlighted.
            var bars = k.querySelectorAll('.bar');
            if (bars.length) g.bars = Array.prototype.map.call(bars, function (b) {
              return { x: b.offsetLeft, y: b.offsetTop, w: b.offsetWidth, h: b.offsetHeight };
            });
            return g;
          })
        };
      });
    }
  </script></body></html>`;
}

/** Render `ld` into `outDir/<n>.png` (one per page) and return the page table. */
export async function renderPages(ld: LyricsDisplay, size: RenderSize, outDir: string, view: EinkView = {}): Promise<Page[]> {
  const full: Required<RenderSize> = { ...size, fontPx: size.fontPx ?? Math.round(size.height / 22) };
  const blocks = blocksFrom(ld, view);
  const browser = await (await chromium()).launch({ channel: "chrome" });
  try {
    const page = await browser.newPage({
      viewport: { width: full.width, height: full.height },
      deviceScaleFactor: full.dpr,
    });
    await page.setContent(pageHtml(blocks, ld.title, full));
    const layout: PageLayout[] = await page.evaluate("paginate()");
    const els = page.locator(".page");
    for (let i = 0; i < layout.length; i++) {
      await els.nth(i).screenshot({ path: join(outDir, `${i}.png`) });
    }
    return assemblePages(blocks, layout);
  } finally {
    await browser.close();
  }
}
