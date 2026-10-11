/**
 * The pieces behind the chart review page (authoring/chart-review-cli.ts):
 * writing a person's answer to a near-repeat question into the manifest,
 * choosing which stem to play for a part, and the stretch of audio to play
 * for a bar.
 */

import type { MappedBar } from "./bar-map.js";

interface ChartEntry {
  id: string;
  instrument?: string;
  sameAs?: Record<string, number>;
  distinct?: number[];
}

/** A copy of `manifest` with `chartId`'s entry changed by `change`. */
function withChart<M extends { charts?: ChartEntry[] }>(manifest: M, chartId: string, change: (c: ChartEntry) => void): M {
  const copy = structuredClone(manifest);
  const chart = copy.charts?.find((c) => c.id === chartId);
  if (!chart) throw new Error(`the manifest has no chart "${chartId}"`);
  change(chart);
  return copy;
}

/** Take a bar out of both answer fields, dropping a field it leaves empty. */
function forget(chart: ChartEntry, scoreBar: number): void {
  if (chart.sameAs) {
    delete chart.sameAs[String(scoreBar)];
    if (!Object.keys(chart.sameAs).length) delete chart.sameAs;
  }
  if (chart.distinct) {
    chart.distinct = chart.distinct.filter((n) => n !== scoreBar);
    if (!chart.distinct.length) delete chart.distinct;
  }
}

/**
 * Record an answer: `like` a bar number means the bar is the same as that
 * bar (sameAs), null means it really is different (distinct). Any earlier
 * answer for the bar is replaced.
 */
export function answer<M extends { charts?: ChartEntry[] }>(manifest: M, chartId: string, scoreBar: number, like: number | null): M {
  return withChart(manifest, chartId, (chart) => {
    forget(chart, scoreBar);
    if (like !== null) chart.sameAs = { ...chart.sameAs, [String(scoreBar)]: like };
    else chart.distinct = [...(chart.distinct ?? []), scoreBar].sort((a, b) => a - b);
  });
}

/** Take a bar's answer out, so the build asks about it again. */
export function clearAnswer<M extends { charts?: ChartEntry[] }>(manifest: M, chartId: string, scoreBar: number): M {
  return withChart(manifest, chartId, (chart) => forget(chart, scoreBar));
}

/**
 * The stem to play for a part: the one named for its instrument, else
 * `other` (a 4-stem split puts guitar and keys there), else none.
 */
export function stemFor(instrument: string, files: Readonly<Record<string, string>> | undefined): string | null {
  if (!files) return null;
  if (files[instrument]) return instrument;
  return files.other ? "other" : null;
}

/**
 * The recording time to play a bar in, with a bar before and after for
 * context (fewer at the song's edges): the first time `section` plays score
 * bar `scoreBar`. `toTime` turns a song beat into recording seconds, or null
 * where the recording doesn't play.
 */
export function playWindow(
  bars: readonly MappedBar[],
  section: number,
  scoreBar: number,
  toTime: (beat: number) => number | null,
): { start: number; end: number } | null {
  const at = bars.findIndex((b) => b.section === section && b.scoreBar === scoreBar);
  if (at < 0) return null;
  const first = bars[Math.max(0, at - 1)];
  const last = bars[Math.min(bars.length - 1, at + 1)];
  const start = toTime(first.startBeat) ?? toTime(bars[at].startBeat);
  const end = toTime(last.startBeat + last.beats) ?? toTime(bars[at].startBeat + bars[at].beats);
  return start === null || end === null ? null : { start, end };
}
