/**
 * Assemble ONE project from pieces of several existing songs.
 *
 * A soundcheck montage ("one chorus from each of twenty songs") and a whole-set
 * show file ("every section of twelve songs, in order, with breaks") are the
 * same operation with different picks — so this is one tool, and a pick's
 * `section` is optional: omit it to take the whole song.
 *
 * The source project is AUTHORITATIVE. A piece plays exactly as it does in its
 * own project: its span is lifted whole (meter, cue flag, manual cue events)
 * and its stems are cropped to the section's source-second range through that
 * song's beat map. Nothing is re-derived, because the band plays the recorded
 * click and any tempo they want is a thing the source project already says.
 *
 * Tempo is per piece, which is why each piece's span carries its own `bpm` and
 * each audio node its own `beatsFile`: `buildRpp`'s shared `recordingBeats`
 * option assumes one recording for the whole project and must NOT be passed
 * here.
 */

import { manifestToSong } from "./manifest-to-song.js";
import { extractSections } from "./sections.js";
import { beatMapCurve } from "../core/beat-map.js";
import { song, seq, span, beats } from "../core/dsongl/index.js";
import type { Audio, Node, Sequence, Song, Span } from "../core/dsongl/index.js";
import { resolveBeatMap } from "../manifest.js";
import type { SongManifest } from "../manifest.js";

/** A source song, already loaded: its manifest, where it lives, its beat grid. */
export interface LoadedSource {
  manifest: SongManifest;
  /** Directory holding the manifest — stem paths resolve against it. */
  dir: string;
  /** Path to this song's `<source>.beats.json`, for stretch markers. */
  beatsFile?: string;
}

/** One piece of the assembled project. */
export interface Pick {
  source: LoadedSource;
  /** Section to lift. Omit to take the whole song. */
  section?: string;
  /** Bars of empty timeline after this piece (a break between songs). */
  gapBars?: number;
  /**
   * Which stems to include, by manifest stem key ("vocals", "horns"). Omit for
   * all of them.
   *
   * Most stems are REFERENCE — the demucs split of the original, there to
   * practice against and muted at the gig. A few are PLAYBACK: a horn or synth
   * part nobody in the band covers, going to the PA for real. A show file wants
   * only the playback ones, and a soundcheck should set levels on what the room
   * actually hears.
   */
  stems?: string[];
}

/** The section spans of a song tree, in order, as `manifestToSong` emitted them. */
function sectionSpans(tree: Song): Span[] {
  const sequence = tree.children.find((c): c is Sequence => c.kind === "sequence");
  return (sequence?.children ?? []).filter((c): c is Span => c.kind === "span" && !!c.name);
}

/** The audio nodes of a song tree. */
function audioNodes(tree: Song): Audio[] {
  return tree.children.filter((c): c is Audio => c.kind === "audio");
}

export function assembleSong(title: string, picks: Pick[]): Song {
  if (picks.length === 0) throw new Error("assembleSong: no picks");

  const spans: Node[] = [];
  const audios: Node[] = [];
  let cursor = 0;          // timeline beat where the next piece starts
  let projectBpm: number | undefined;
  let projectTs: [number, number] | undefined;

  for (const pick of picks) {
    const { manifest: raw, dir, beatsFile } = pick.source;
    // Sources come straight off disk, where the beat map is normally an
    // external `<source>.beatmap.json` ref. `manifestToSong` reads the map
    // itself, so resolve BEFORE building the tree — and copy rather than
    // mutate, since callers hand us their own manifests.
    const beatMap = resolveBeatMap(raw.sources.recording.beatMap, dir);
    const manifest: SongManifest = {
      ...raw,
      sources: { ...raw.sources, recording: { ...raw.sources.recording, beatMap } },
    };
    const tree = manifestToSong(manifest, dir);
    const allSpans = sectionSpans(tree);
    const allSections = extractSections(tree);
    if (allSpans.length !== allSections.length) {
      throw new Error(
        `${manifest.title}: ${allSpans.length} section spans but ${allSections.length} extracted sections`,
      );
    }

    // Which sections this pick takes, and the source-beat range they cover.
    let from = 0;
    if (pick.section !== undefined) {
      from = allSections.findIndex((s) => s.name === pick.section);
      if (from < 0) {
        throw new Error(
          `${manifest.title} has no section "${pick.section}" — ` +
            `has ${allSections.map((s) => `"${s.name}"`).join(", ")}`,
        );
      }
    }
    const to = pick.section === undefined ? allSections.length - 1 : from;
    const startBeat = allSections[from].beat;
    const endBeat = allSections[to].beat + allSections[to].durationBeats;

    projectBpm ??= allSections[from].bpm;
    projectTs ??= allSections[from].timeSignature;

    // Spans carry over whole — meter, cue flag and any manual cue events — with
    // the source tempo stamped on, since the assembled project's own bpm is
    // only the first piece's and every later piece must override it.
    for (let i = from; i <= to; i++) {
      spans.push({ ...allSpans[i], name: `${manifest.title} · ${allSections[i].name}`, bpm: allSections[i].bpm });
    }

    // Stems, cropped to the picked range through this song's beat map.
    const curve = beatMapCurve(beatMap, manifest.bpm);
    // `manifestToSong` title-cases the stem key into the track name, so match
    // case-insensitively against the keys the caller asked for.
    const wanted = pick.stems && new Set(pick.stems.map((k) => k.toLowerCase()));
    const nodes = audioNodes(tree).filter((n) => !wanted || wanted.has(n.name.toLowerCase()));
    if (wanted && nodes.length === 0) {
      throw new Error(
        `${manifest.title} has no stems named ${pick.stems!.map((s) => `"${s}"`).join(", ")} — ` +
          `has ${Object.keys(manifest.sources.stems?.files ?? {}).map((s) => `"${s}"`).join(", ")}`,
      );
    }
    if (pick.section === undefined) {
      // Whole song: lift the items as they are (this preserves `clips`), moved
      // to the piece's place on the timeline.
      for (const node of nodes) {
        audios.push({
          ...node,
          offset: (node.offset ?? 0) - startBeat + cursor,
          ...(beatsFile !== undefined ? { beatsFile } : {}),
        });
      }
    } else {
      // One section: crop. A clipped source has several items per stem with a
      // rearranged source order, so a section no longer maps to one range.
      if (manifest.sources.stems?.clips?.length) {
        throw new Error(
          `${manifest.title} uses clips — pick the whole song rather than one section`,
        );
      }
      const soffs = curve.toTime(startBeat);
      const sourceEnd = curve.toTime(endBeat);
      for (const node of nodes) {
        audios.push({
          ...node,
          offset: cursor,
          soffs,
          sourceEnd,
          ...(beatsFile !== undefined ? { beatsFile } : {}),
        });
      }
    }

    cursor += endBeat - startBeat;

    if (pick.gapBars) {
      const beatsPerBar = allSections[to].timeSignature[0];
      const gap = pick.gapBars * beatsPerBar;
      spans.push(span("", beats(gap)));   // unnamed: space, not a section
      cursor += gap;
    }
  }

  return song(
    title,
    projectBpm!,
    { timeSignature: projectTs! },
    seq(...spans),
    ...audios,
  );
}
