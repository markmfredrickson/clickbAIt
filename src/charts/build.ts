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
import { chartStyle, type ChartSpec, type ChordsSpec, type ScoreSpec } from "../manifest.js";
import { transposeSteps, type TransposeSpec } from "../build/transpose.js";
import { mapScore, songSections, type MappedBar, type SongSection } from "./bar-map.js";
import { chordName, transposeChord } from "./chord-label.js";
import { figureChart, scoredSections, type FigureChart } from "./figures.js";
import { chordBeats, type ChordTiming } from "./chord-timeline.js";
import { parseLab } from "./lab.js";
import { readScoreInfo, type ScoreInfo } from "./score-info.js";

export interface BuiltChart extends ChartSpec {
  /** The score file, relative to the song folder. */
  source: string;
  /** The score track's own name, for labeling. */
  trackName: string;
  bars: MappedBar[];
  /** How it's drawn: `chart` (its figures) or `score` (every bar). See chartStyle. */
  style: "chart" | "score";
  /** Chart style: the part as figure letters, section by section. */
  figures?: FigureChart;
  /** Chart style: the sections drawn bar by bar anyway, by index (the manifest's
   *  scoreSections, and those no bar repeats in). */
  sectionsAsScore?: number[];
  /** Score bars where this track plays nothing but rests (1-based). */
  restBars: number[];
}

export interface ChartsFile {
  schema: "clickbait/charts@1";
  slug: string;
  sections: SongSection[];
  charts: BuiltChart[];
  /** The song's chords on the timeline, when the manifest has a chord file. */
  chords?: ChartChord[];
}

export interface ChartChord {
  /** As a chart shows it, in the key the band plays: "F#m7", "E/G#", "N.C.". */
  chord: string;
  beat: number;
}

/** The parts of a manifest the charts file needs. */
export interface ChartsSong {
  title: string;
  artist?: string;
  timeSignature: [number, number];
  sections: { name: string; bars: number; timeSignature?: [number, number] }[];
  scores?: ScoreSpec[];
  charts?: ChartSpec[];
  chords?: ChordsSpec;
  transpose?: TransposeSpec;
}

export function buildChartsFile(
  song: ChartsSong,
  readFile: (name: string) => Uint8Array,
  opts: { timing?: ChordTiming } = {},
): ChartsFile {
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
    const style = chartStyle(chart);
    const signatures = score.info.signatures[chart.track] ?? [];
    // A bar's signature lists each beat's notes in brackets; a rest bar has none.
    const restBars = signatures.flatMap((sig, i) => (/\[[^\]]/.test(sig) ? [] : [i + 1]));
    // A chart's sections drawn as scores: those the manifest names (every
    // occurrence), and those that read better bar by bar. Its snippets come from the rest.
    const sectionsAsScore =
      style === "chart"
        ? scoredSections(score.bars, signatures, sections, sections.flatMap((s, i) => (chart.scoreSections?.includes(s.name) ? [i] : [])))
        : undefined;
    const figures = style === "chart" ? figureChart(score.bars, signatures, sections, { asScore: sectionsAsScore }) : undefined;
    charts.push({
      ...chart,
      style,
      source: spec.file,
      trackName: track.name,
      bars: score.bars,
      restBars,
      ...(figures ? { figures, sectionsAsScore } : {}),
    });
  }

  let chords: ChartChord[] | undefined;
  if (song.chords) {
    const where = `chords (${song.chords.file})`;
    const placed = readChords(song, song.chords, readFile, opts.timing);
    errors.push(...placed.errors.map((e) => `${where}: ${e}`));
    chords = placed.chords;
  }
  if (errors.length > 0) {
    throw new Error(`charts for "${song.title}" have ${errors.length} problem(s):\n  ${errors.join("\n  ")}`);
  }
  return {
    schema: "clickbait/charts@1",
    slug: songSlug({ title: song.title, artist: song.artist } as Song),
    sections,
    charts,
    ...(chords ? { chords } : {}),
  };
}

/**
 * The chord file's chords on the timeline: each label read (and transposed,
 * for a file in the recording's key), then its start placed through the
 * recording's timing.
 */
function readChords(
  song: ChartsSong,
  spec: ChordsSpec,
  readFile: (name: string) => Uint8Array,
  timing: ChordTiming | undefined,
): { chords: ChartChord[]; errors: string[] } {
  if (!timing) return { chords: [], errors: ["needs the recording's timing to place its chords"] };
  let text: string;
  try {
    text = new TextDecoder().decode(readFile(spec.file));
  } catch (err) {
    return { chords: [], errors: [(err as Error).message] };
  }
  const { segments, errors } = parseLab(text);

  const steps = spec.key === "source" && song.transpose !== undefined ? transposeSteps(song.transpose) : 0;
  const toKey = typeof song.transpose === "object" ? song.transpose.to : undefined;
  if (steps !== 0 && !toKey) {
    return { chords: [], errors: [...errors, "set transpose.to, the key to spell the transposed chords in"] };
  }
  const names = segments.map((seg) => {
    try {
      return steps !== 0 ? transposeChord(seg.label, steps, toKey!) : chordName(seg.label);
    } catch (err) {
      errors.push(`line ${seg.line}: ${(err as Error).message}`);
      return null;
    }
  });
  const chords = chordBeats(segments, timing).flatMap(({ segment, beat }) => {
    const chord = names[segment];
    return chord === null ? [] : [{ chord, beat }];
  });
  return { chords, errors };
}
