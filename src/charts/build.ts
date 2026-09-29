/**
 * The built charts file, `<slug>.charts.json`: the song's sections on the
 * timeline, and for each chart in the manifest, which score bar plays in
 * each of our bars. Derived at build from the manifest and the score files;
 * never edited by hand.
 *
 * Every problem across every chart is collected and reported together, so a
 * build fails once with the full list instead of once per fix.
 */

import { songSlug } from "../core/dsongl/index.js";
import type { Song } from "../core/dsongl/types.js";
import type { ChartSpec } from "../manifest.js";
import { mapChart, songSections, type MappedBar, type SongSection } from "./bar-map.js";
import { readScoreInfo, type ScoreInfo } from "./score-info.js";

export interface BuiltChart extends ChartSpec {
  /** The score track's own name, for labeling. */
  trackName: string;
  bars: MappedBar[];
}

export interface ChartsFile {
  schema: "clickbait/charts@1";
  slug: string;
  sections: SongSection[];
  charts: Omit<BuiltChart, "sections">[];
}

/** The parts of a manifest the charts file needs. */
export interface ChartsSong {
  title: string;
  artist?: string;
  timeSignature: [number, number];
  sections: { name: string; bars: number; timeSignature?: [number, number] }[];
  charts?: ChartSpec[];
}

export function buildChartsFile(song: ChartsSong, readFile: (name: string) => Uint8Array): ChartsFile {
  const sections = songSections(song.sections, song.timeSignature);
  const errors: string[] = [];
  const scores = new Map<string, ScoreInfo | null>();
  const scoreFor = (source: string): ScoreInfo | null => {
    if (!scores.has(source)) {
      try {
        scores.set(source, readScoreInfo(readFile(source), source));
      } catch (err) {
        errors.push(`score file ${source}: ${(err as Error).message}`);
        scores.set(source, null);
      }
    }
    return scores.get(source)!;
  };

  const charts: ChartsFile["charts"] = [];
  for (const spec of song.charts ?? []) {
    const score = scoreFor(spec.source);
    if (!score) continue;
    const mapped = mapChart(spec, sections, score);
    errors.push(...mapped.errors);
    const { sections: _links, ...rest } = spec;
    charts.push({ ...rest, trackName: score.tracks[spec.track]?.name ?? "", bars: mapped.bars });
  }
  if (errors.length > 0) {
    throw new Error(`charts for "${song.title}" have ${errors.length} problem(s):\n  ${errors.join("\n  ")}`);
  }
  return {
    schema: "clickbait/charts@1",
    slug: songSlug({ title: song.title, artist: song.artist } as Song),
    sections,
    charts,
  };
}
