/**
 * Drawing bars of a score with alphaTab, in the browser.
 *
 * alphaTab is large, so it loads only when a notation channel is first shown,
 * from the relay's /vendor/alphatab/ (its script and the Bravura music font).
 * A score file is read once and shared by every bar drawn from it.
 */

// alphaTab's script defines a global; its types aren't bundled into the client.
declare global {
  interface Window {
    alphaTab?: any;
  }
}

import { chartSettings, detachRange, showStaves } from "../../charts/notation-settings.js";
import type { ChartKind } from "../rows.js";
import { placeDrawing, type NotationTarget } from "./pane-view.js";

const BASE = "/vendor/alphatab/";
let loading: Promise<any> | null = null;

export function loadAlphaTab(): Promise<any> {
  if (window.alphaTab) return Promise.resolve(window.alphaTab);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = BASE + "alphaTab.min.js";
      script.onload = () => (window.alphaTab ? resolve(window.alphaTab) : reject(new Error("alphaTab didn't load")));
      script.onerror = () => reject(new Error("couldn't load alphaTab"));
      document.head.appendChild(script);
    });
  }
  return loading;
}

/** Fetch and read a score file (Guitar Pro, MusicXML, alphaTex). */
export async function loadScore(url: string): Promise<any> {
  const at = await loadAlphaTab();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`couldn't fetch ${url} (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const score = at.importer.ScoreLoader.loadScoreFromBytes(bytes, new at.Settings());
  // A chart shows bars out of context, so their numbers only confuse.
  score.stylesheet.barNumberDisplay = 2; // BarNumberDisplay.Hide
  return score;
}

/** A CSS color ("rgb(204, 204, 204)") as "#rrggbb", which alphaTab reads. */
function hex(color: string): string {
  const m = color.match(/\d+(\.\d+)?/g);
  if (!m || m.length < 3) return "#000000";
  return "#" + m.slice(0, 3).map((v) => Math.round(Number(v)).toString(16).padStart(2, "0")).join("");
}

/**
 * Draw bars `start`… (`count` of them, 1-based) of one track into `el`, in
 * the chart's kind (see chartSettings), in `ink` (a CSS color) on a clear
 * background so it sits on the page like the text around it. The prompter
 * credits alphaTab once in its drawer instead of under every drawing.
 * alphaTab draws again when its container changes size, so `onDrawn` hears
 * where the bars landed after every drawing; the promise resolves after the
 * first.
 */
export function renderRange(
  at: any,
  el: HTMLElement,
  score: any,
  track: number,
  chart: ChartKind,
  start: number,
  count: number,
  ink: string,
  onDrawn: (drawing: { width: number; bars: { x: number; w: number }[] }) => void,
): Promise<void> {
  const api = new at.AlphaTabApi(el, chartSettings(chart, start, count, hex(ink), BASE + "font/"));
  const done = new Promise<void>((resolve) => {
    api.renderFinished.on(() => {
      el.querySelectorAll("text").forEach((t) => {
        if (/rendered by alphaTab/i.test(t.textContent ?? "")) t.remove();
      });
      const system = api.renderer.boundsLookup?.staffSystems?.[0];
      const bars = (system?.bars ?? []).map((b: any) => ({ x: b.realBounds.x, w: b.realBounds.w }));
      // The drawing's width in the bounds' own units: its widest SVG, which
      // alphaTab sizes before any CSS zoom (its container isn't sized yet).
      let width = 0;
      el.querySelectorAll("svg").forEach((svg) => {
        width = Math.max(width, (parseFloat((svg.parentElement as HTMLElement)?.style.left || "0") || 0) + (parseFloat(svg.getAttribute("width") || "0") || 0));
      });
      onDrawn({ width, bars });
      resolve();
    });
    // A drawing alphaTab can't finish leaves its space empty rather than
    // holding up the page (e-ink waits for every drawing before paging).
    api.error.on((e: unknown) => {
      console.warn(`notation: bars ${start}–${start + count - 1} of track ${track}: ${e instanceof Error ? e.message : e}`);
      resolve();
    });
  });
  api.renderScore(score, [track]);
  return done;
}

/** Draw each target's bars of `track` from the score at `scoreUrl`, in the chart's kind and `ink`. */
export async function drawNotation(
  targets: readonly NotationTarget[],
  scoreUrl: string,
  track: number,
  chart: ChartKind,
  ink: string,
): Promise<void> {
  if (!targets.length) return;
  const [at, score] = await Promise.all([loadAlphaTab(), loadScore(scoreUrl)]);
  showStaves(score, track, chart);
  await Promise.all(
    targets.map((t) => {
      detachRange(score, track, t.start, t.count);
      return renderRange(at, t.el, score, track, chart, t.start, t.count, ink, (d) => placeDrawing(t, d));
    }),
  );
}
