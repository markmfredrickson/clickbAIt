/**
 * The built charts file, `<slug>.charts.json`: the song's sections on the
 * timeline, and for each chart in the manifest, which score bar plays in
 * each of our bars. Derived at build from the manifest and the score files;
 * never edited by hand.
 *
 * Each score used by a chart is read and mapped once; its charts share the
 * result. Every problem is collected and reported together, so a build fails
 * once with the full list instead of once per fix.
 */

import { songSlug } from "../core/dsongl/index.js";
import type { Song } from "../core/dsongl/types.js";
import type { ChartSpec, ScoreSpec } from "../manifest.js";
import { mapScore, songSections, type MappedBar, type SongSection } from "./bar-map.js";
import { readScoreInfo, type ScoreInfo } from "./score-info.js";

export interface BuiltChart extends ChartSpec {
  /** The score file, relative to the song folder. */
  source: string;
  /** The score track's own name, for labeling. */
  trackName: string;
  bars: MappedBar[];
}

export interface ChartsFile {
  schema: "clickbait/charts@1";
  slug: string;
  sections: SongSection[];
  charts: BuiltChart[];
}

/** The parts of a manifest the charts file needs. */
export interface ChartsSong {
  title: string;
  artist?: string;
  timeSignature: [number, number];
  sections: { name: string; bars: number; timeSignature?: [number, number] }[];
  scores?: ScoreSpec[];
  charts?: ChartSpec[];
}

export function buildChartsFile(song: ChartsSong, readFile: (name: string) => Uint8Array): ChartsFile {
  const sections = songSections(song.sections, song.timeSignature);
  const errors: string[] = [];

  // Map each score once, the first time a chart asks for it.
  const mapped = new Map<string, { info: ScoreInfo; bars: MappedBar[] } | null>();
  const scoreFor = (spec: ScoreSpec) => {
    if (!mapped.has(spec.id)) {
      try {
        const info = readScoreInfo(readFile(spec.file), spec.file);
        const result = mapScore(spec, sections, info);
        errors.push(...result.errors);
        mapped.set(spec.id, { info, bars: result.bars });
      } catch (err) {
        errors.push(`score "${spec.id}" (${spec.file}): ${(err as Error).message}`);
        mapped.set(spec.id, null);
      }
    }
    return mapped.get(spec.id)!;
  };

  const charts: BuiltChart[] = [];
  for (const chart of song.charts ?? []) {
    // The manifest schema already checked that the score exists.
    const spec = song.scores?.find((s) => s.id === chart.score);
    const score = spec ? scoreFor(spec) : null;
    if (!spec || !score) continue;
    const track = score.info.tracks[chart.track];
    if (!track) {
      errors.push(
        `chart "${chart.id}": score "${spec.id}" has ${score.info.tracks.length} tracks, so there is no track ${chart.track}`,
      );
      continue;
    }
    charts.push({ ...chart, source: spec.file, trackName: track.name, bars: score.bars });
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
