/**
 * Notation drawn ahead of time, for practice bundles. A bundle opens from
 * disk with no relay to serve alphaTab or the score, so the bundle builder
 * draws every range of bars its charts show here, in Node, as SVG (see
 * teleprompter/drawings.ts for which), and the bundle carries the drawings
 * and the music font.
 *
 * Ranges are drawn with the browser's settings (notation-settings.ts) and
 * inked in `currentColor`, so they take the page's text color in either
 * theme. alphaTab draws noteheads and other symbols as text in its music
 * font (Bravura), which notationCss embeds.
 */

import * as alphaTab from "@coderline/alphatab";
import type { ChartKind } from "../teleprompter/rows.js";
import { drawingKey, type Drawing } from "../teleprompter/drawings.js";
import { chartSettings, detachRange, showStaves } from "./notation-settings.js";

/** Drawn in this, then swapped for currentColor; nothing in a score uses it. */
const SENTINEL = "#010203";

/**
 * Draw each range of `track` (1-based score bars), by drawingKey. A range
 * alphaTab can't draw is left out with a warning, so the display shows a gap
 * there rather than the bundle failing to build.
 */
export async function renderRanges(
  score: Uint8Array,
  track: number,
  chart: ChartKind,
  ranges: readonly { start: number; count: number }[],
): Promise<Record<string, Drawing>> {
  const loaded = alphaTab.importer.ScoreLoader.loadScoreFromBytes(score, new alphaTab.Settings());
  // A chart shows bars out of context, so their numbers only confuse.
  loaded.stylesheet.barNumberDisplay = alphaTab.model.BarNumberDisplay.Hide;
  showStaves(loaded, track, chart);
  const out: Record<string, Drawing> = {};
  for (const r of ranges) {
    try {
      detachRange(loaded as never, track, r.start, r.count);
      out[drawingKey(r.start, r.count)] = await renderRange(loaded, track, chart, r.start, r.count);
    } catch (err) {
      console.warn(`warning: couldn't draw bars ${r.start}–${r.start + r.count - 1} of track ${track}: ${(err as Error).message}`);
    }
  }
  return out;
}

function renderRange(score: alphaTab.model.Score, track: number, chart: ChartKind, start: number, count: number): Promise<Drawing> {
  const settings = new alphaTab.Settings();
  settings.fillFromJson(chartSettings(chart, start, count, SENTINEL) as never);
  const renderer = new alphaTab.rendering.ScoreRenderer(settings);
  renderer.width = 8000;
  return new Promise((resolve, reject) => {
    const parts: alphaTab.rendering.RenderFinishedEventArgs[] = [];
    renderer.partialRenderFinished.on((r) => parts.push(r));
    renderer.error.on((e) => reject(e));
    renderer.renderFinished.on(() => {
      // alphaTab's credit comes as its own part; the prompter credits it once.
      const drawn = parts.filter((p) => p.renderResult && !/rendered by alphaTab/i.test(p.renderResult as string));
      if (!drawn.length) return reject(new Error(`bars ${start}–${start + count - 1}: nothing drawn`));
      const width = Math.ceil(Math.max(...drawn.map((p) => p.x + p.width)));
      const height = Math.ceil(Math.max(...drawn.map((p) => p.y + p.height)));
      // One part is the drawing; several are laid out where alphaTab put them.
      const svg =
        drawn.length === 1
          ? (drawn[0].renderResult as string)
          : `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${width}px" height="${height}px">` +
            drawn.map((p) => (p.renderResult as string).replace("<svg ", `<svg x="${p.x}" y="${p.y}" `)).join("") +
            "</svg>";
      const system = renderer.boundsLookup?.staffSystems[0];
      const bars = (system?.bars ?? []).map((b) => ({ x: b.realBounds.x, w: b.realBounds.w }));
      resolve({ svg: svg.replaceAll(`"${SENTINEL}"`, '"currentColor"').trim(), width, height, bars });
    });
    renderer.renderScore(score, [track]);
  });
}

/** CSS for drawn notation: the music font, embedded, and the size alphaTab draws its symbols at. */
export function notationCss(woff2: Uint8Array): string {
  const size = new alphaTab.Settings().display.resources.engravingSettings.musicFontSize;
  return `@font-face { font-family: "clickbait-notation"; font-display: block; src: url(data:font/woff2;base64,${Buffer.from(woff2).toString("base64")}) format("woff2"); }
.notation .at { font-family: "clickbait-notation"; font-style: normal; font-weight: normal; line-height: 1; font-size: ${size}px; overflow: visible; }`;
}
