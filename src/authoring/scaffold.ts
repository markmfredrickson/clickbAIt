/**
 * Manifest scaffolder — the deterministic first cut of a `<slug>.song.json`.
 *
 * This does ONLY the mechanical assembly: BPM, beat-map (from the unified beat
 * grid), stem wiring, the alignment reference, and the Genius lyric block parsed
 * into labeled sections with their lines nested. Everything that needs musical
 * judgment — real bar counts, instrumental sections Genius doesn't label, meter
 * changes, count-in cues — is deliberately LEFT for Claude/the user to fill in
 * on review. Sections come out with a placeholder bar count.
 *
 * Doing the lyric parse in code (file-to-file, lookup → manifest) also keeps the
 * lyric text out of the model's context.
 */

import { SongManifestSchema, type SongManifest } from "../manifest.js";
import { beatsToBeatMap } from "../core/beat-map.js";

/** Pull the raw lyric block out of a lookup file's text — the content between
 *  the `---lyrics-raw---` / `---end-lyrics-raw---` sentinels. "" if absent. */
export function lyricBlockFromLookup(lookupText: string): string {
  const start = lookupText.indexOf("---lyrics-raw---");
  if (start < 0) return "";
  const afterStart = start + "---lyrics-raw---".length;
  const end = lookupText.indexOf("---end-lyrics-raw---", afterStart);
  const block = end < 0 ? lookupText.slice(afterStart) : lookupText.slice(afterStart, end);
  return block.trim();
}

/** A section parsed from a Genius lyric block: its label and its lyric lines in
 *  order (headers and blank lines removed). Instrumental sections have none. */
export interface GeniusSection {
  name: string;
  lines: string[];
}

const HEADER = /^\[(.+)\]$/;

/**
 * Split a raw Genius lyric block into labeled sections. A `[Label]` line opens a
 * section; the lines up to the next label are its lyrics (blank lines dropped).
 * Anything before the first label is ignored. A label's featured-artist
 * annotation is stripped: `[Verse 1: Testus Maximus]` → name `"Verse 1"`.
 */
export function parseGeniusSections(block: string): GeniusSection[] {
  const sections: GeniusSection[] = [];
  let current: GeniusSection | undefined;
  for (const raw of block.split("\n")) {
    const line = raw.trim();
    const m = line.match(HEADER);
    if (m) {
      current = { name: m[1].split(":")[0].trim(), lines: [] };
      sections.push(current);
    } else if (line && current) {
      current.lines.push(line);
    }
  }
  return sections;
}

/**
 * The flat lyric text fed to the aligner: every section's lines in order, one
 * per row, with `[Section]` headers and blank lines removed. File-to-file (the
 * lookup sidecar → a `lyrics.txt`), so the lyric text never enters the model's
 * context. The line order here must match the sections' `lines` order in the
 * manifest — both come from the same parse, so they agree by construction.
 */
export function lyricsTextFromLookup(lookupText: string): string {
  return parseGeniusSections(lyricBlockFromLookup(lookupText))
    .flatMap((s) => s.lines)
    .join("\n");
}

/**
 * Fold the detected tempo by 2× when the tracker locked onto the wrong pulse
 * subdivision. `half` halves the BPM and keeps every other beat (`phase` picks
 * the on/off pulse); `double` doubles the BPM and inserts the midpoint beats.
 * Returns the adjusted `{ bpm, times }`. No mode → unchanged.
 */
export function foldBeats(
  bpm: number,
  times: number[],
  mode?: "half" | "double",
  phase: 0 | 1 = 0,
): { bpm: number; times: number[] } {
  if (mode === "half") {
    return { bpm: bpm / 2, times: times.filter((_, i) => i % 2 === phase) };
  }
  if (mode === "double") {
    const out: number[] = [];
    for (let i = 0; i < times.length; i++) {
      out.push(times[i]);
      if (i + 1 < times.length) out.push((times[i] + times[i + 1]) / 2);
    }
    return { bpm: bpm * 2, times: out };
  }
  return { bpm, times };
}

export interface ScaffoldInputs {
  title: string;
  artist?: string;
  key?: string;
  /** BPM (already folded if a fold was applied). */
  bpm: number;
  timeSignature?: [number, number];
  /** Unified beat grid: source-second per beat, in order. */
  beats: number[];
  /** Song-beat of the grid's first entry (negative for a pickup). Default 0. */
  startBeat?: number;
  /** Source audio filename, relative to the manifest (e.g. "source.m4a"). */
  sourceFile: string;
  /** Stem group, if stems exist. */
  stems?: { dir: string; files: Record<string, string> };
  /** Alignment sidecar path relative to the manifest. */
  alignFile?: string;
  /** Raw Genius lyric block (from `lyricBlockFromLookup`). */
  genius?: string;
  /** Tag applied to every scaffolded lyric line. Default "Lead Vocal". */
  lyricTag?: string;
  /** Placeholder bar count on scaffolded sections (Claude sets the real value). */
  placeholderBars?: number;
}

/**
 * Assemble a draft manifest and validate it against `SongManifestSchema`. Throws
 * if the result is invalid (a scaffolder bug), so callers get a parsed,
 * schema-clean `SongManifest`.
 */
export function buildScaffold(inp: ScaffoldInputs): SongManifest {
  const tag = inp.lyricTag ?? "Lead Vocal";
  const bars = inp.placeholderBars ?? 8;

  const sections = (inp.genius ? parseGeniusSections(inp.genius) : []).map((s) => {
    const base: Record<string, unknown> = { name: s.name, bars, cue: true };
    if (s.lines.length) base.lines = s.lines.map((text) => ({ text, tag }));
    return base;
  });

  const manifest: Record<string, unknown> = {
    schema: "clickbait/song@1",
    title: inp.title,
    ...(inp.artist ? { artist: inp.artist } : {}),
    ...(inp.key ? { key: inp.key } : {}),
    bpm: inp.bpm,
    timeSignature: inp.timeSignature ?? [4, 4],
    preRollBars: 0,
    sources: {
      recording: {
        kind: "audio",
        file: inp.sourceFile,
        beatMap: beatsToBeatMap(inp.beats, inp.startBeat ?? 0),
      },
      ...(inp.stems
        ? {
            stems: {
              kind: "audio-group",
              curveRef: "recording",
              dir: inp.stems.dir,
              files: inp.stems.files,
            },
          }
        : {}),
    },
    songCurve: "constantBpm",
    sections,
    lyrics: inp.alignFile
      ? { alignment: { file: inp.alignFile } }
      : {},
  };

  return SongManifestSchema.parse(manifest);
}
