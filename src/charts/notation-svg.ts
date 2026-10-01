/**
 * Drum staffs drawn ahead of time, for practice bundles. A bundle opens from
 * disk with no relay to serve alphaTab or the score, so the bundle builder
 * draws each bar a chart shows here, in Node, as SVG, and the bundle carries
 * the SVGs and the music font.
 *
 * The bars are drawn with the browser's settings (notation-settings.ts) and
 * inked in `currentColor`, so they take the page's text color in either
 * theme. alphaTab draws noteheads and other symbols as text in its music
 * font (Bravura), which notationCss embeds.
 */

import * as alphaTab from "@coderline/alphatab";
import type { RowDocument } from "../teleprompter/rows.js";
import { barSettings } from "./notation-settings.js";

/** Drawn in this, then swapped for currentColor; nothing in a score uses it. */
const SENTINEL = "#010203";

/** Draw `bars` (1-based score bars) of `track`, as an SVG each, by bar. */
export function renderBars(score: Uint8Array, track: number, bars: readonly number[]): Promise<Record<number, string>> {
  const loaded = alphaTab.importer.ScoreLoader.loadScoreFromBytes(score, new alphaTab.Settings());
  // A chart shows bars out of context, so their numbers only confuse.
  loaded.stylesheet.barNumberDisplay = alphaTab.model.BarNumberDisplay.Hide;
  return bars.reduce<Promise<Record<number, string>>>(
    async (done, bar) => ({ ...(await done), [bar]: await renderBar(loaded, track, bar) }),
    Promise.resolve({}),
  );
}

function renderBar(score: alphaTab.model.Score, track: number, bar: number): Promise<string> {
  const settings = new alphaTab.Settings();
  settings.fillFromJson(barSettings(bar, SENTINEL) as never);
  const renderer = new alphaTab.rendering.ScoreRenderer(settings);
  renderer.width = 4000;
  return new Promise((resolve, reject) => {
    const parts: alphaTab.rendering.RenderFinishedEventArgs[] = [];
    renderer.partialRenderFinished.on((r) => parts.push(r));
    renderer.error.on((e) => reject(e));
    renderer.renderFinished.on(() => {
      // alphaTab's credit comes as its own part; the prompter credits it once.
      const svg = parts
        .map((p) => p.renderResult as string | null)
        .filter((s): s is string => !!s && !/rendered by alphaTab/i.test(s));
      if (svg.length !== 1) return reject(new Error(`bar ${bar}: expected one drawing, got ${svg.length}`));
      resolve(svg[0].replaceAll(`"${SENTINEL}"`, '"currentColor"').trim());
    });
    renderer.renderScore(score, [track]);
  });
}

/** The score bars each drum channel draws: where a section first plays a groove. */
export function notationBars(doc: RowDocument): { id: string; source: string; track: number; bars: number[] }[] {
  return doc.channels.flatMap((c) => {
    if (c.kind !== "drums") return [];
    const bars = new Set<number>();
    for (const row of c.rows) for (const run of row.items) if (run.first && run.scoreBar !== null) bars.add(run.scoreBar);
    return [{ id: c.id, source: c.source, track: c.track, bars: [...bars].sort((a, b) => a - b) }];
  });
}

/** CSS for drawn staffs: the music font, embedded, and the size alphaTab draws its symbols at. */
export function notationCss(woff2: Uint8Array): string {
  const size = new alphaTab.Settings().display.resources.engravingSettings.musicFontSize;
  return `@font-face { font-family: "clickbait-notation"; font-display: block; src: url(data:font/woff2;base64,${Buffer.from(woff2).toString("base64")}) format("woff2"); }
.drum-notation .at { font-family: "clickbait-notation"; font-style: normal; font-weight: normal; line-height: 1; font-size: ${size}px; overflow: visible; }`;
}
