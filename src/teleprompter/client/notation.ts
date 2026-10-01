/**
 * Drawing single bars of a score with alphaTab, in the browser.
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

import { barSettings } from "../../charts/notation-settings.js";

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
 * Draw one bar (1-based) of one track into `el` (see barSettings), in `ink`
 * (a CSS color) on a clear background so it sits on the page like the text
 * around it. The prompter credits alphaTab once in its drawer instead of
 * under every bar. Resolves once the bar is drawn.
 */
export function renderBar(at: any, el: HTMLElement, score: any, track: number, bar: number, ink: string): Promise<void> {
  const color = hex(ink);
  const api = new at.AlphaTabApi(el, barSettings(bar, color, BASE + "font/"));
  const done = new Promise<void>((resolve) => {
    api.renderFinished.on(() => {
      el.querySelectorAll("text").forEach((t) => {
        if (/rendered by alphaTab/i.test(t.textContent ?? "")) t.remove();
      });
      resolve();
    });
  });
  api.renderScore(score, [track]);
  return done;
}

/** Draw each target's bar of `track` from the score at `scoreUrl`, in `ink`. */
export async function drawNotation(
  targets: readonly { el: HTMLElement; scoreBar: number }[],
  scoreUrl: string,
  track: number,
  ink: string,
): Promise<void> {
  if (!targets.length) return;
  const [at, score] = await Promise.all([loadAlphaTab(), loadScore(scoreUrl)]);
  await Promise.all(targets.map((t) => renderBar(at, t.el, score, track, t.scoreBar, ink)));
}
