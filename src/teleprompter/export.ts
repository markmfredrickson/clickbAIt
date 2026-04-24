/**
 * Transform a Song into a SongPayload for the teleprompter browser client.
 * Groups linearized events by section, with lyrics, chords, and timing.
 */

import type { Song } from "../dsongl/index.js";
import { toSlug, songSlug } from "../dsongl/index.js";
import type { LinearEvent } from "../linearize.js";
import type { SongPayload, Section, LyricLine, ChordMark, TempoPoint } from "./types.js";
import { linearize } from "../linearize.js";
import { extractSections } from "../sections.js";
import { beatToSeconds } from "../tempo.js";

export { toSlug, songSlug };

export interface ExportOptions {
  /** Beats of slug padding to prepend (matches buildRpp's slugBeats so the
   *  teleprompter's beat frame aligns with REAPER's project timeline). */
  minPaddingBeats?: number;
}

export function exportSongPayload(song: Song, opts: ExportOptions = {}): SongPayload {
  const { events } = linearize(song, { withPadding: true, minPaddingBeats: opts.minPaddingBeats ?? 0 });
  const rawSections = extractSections(song);
  const shift = opts.minPaddingBeats ?? 0;
  const sections = rawSections.map(s => ({ ...s, beat: s.beat + shift }));

  // Build a tempo map so we can convert beats→seconds for section boundaries
  const tempoMap = buildTempoMap(events);

  const exportedSections: Section[] = sections.map((sec, i) => {
    const nextBeat = i < sections.length - 1
      ? sections[i + 1].beat
      : sec.beat + sec.durationBeats;

    // Collect lyrics and chords that fall within this section's beat range
    const lyrics: LyricLine[] = [];
    const chords: ChordMark[] = [];

    for (const ev of events) {
      if (ev.beat < sec.beat || ev.beat >= nextBeat) continue;
      if (ev.type === "lyric") {
        lyrics.push({
          text: ev.value,
          beat: ev.beat,
          seconds: ev.seconds,
          tag: ev.tag,
        });
      } else if (ev.type === "chord") {
        chords.push({
          chord: ev.value,
          beat: ev.beat,
          seconds: ev.seconds,
        });
      }
    }

    return {
      name: sec.name,
      beat: sec.beat,
      seconds: beatToSeconds(sec.beat, tempoMap),
      durationBeats: sec.durationBeats,
      durationSeconds: beatToSeconds(sec.beat + sec.durationBeats, tempoMap)
        - beatToSeconds(sec.beat, tempoMap),
      lyrics,
      chords,
    };
  });

  // Build tempo map with seconds for each tempo change
  const tempoPoints: TempoPoint[] = tempoMap.map((t) => ({
    beat: t.beat,
    seconds: beatToSeconds(t.beat, tempoMap),
    bpm: t.bpm,
  }));

  return {
    title: song.title,
    artist: song.artist,
    key: song.key,
    bpm: song.bpm,
    slug: songSlug(song),
    tempoMap: tempoPoints,
    sections: exportedSections,
  };
}

interface TempoEntry { beat: number; bpm: number; }

function buildTempoMap(events: LinearEvent[]): TempoEntry[] {
  return events
    .filter((e) => e.type === "tempo")
    .map((e) => ({ beat: e.beat, bpm: Number(e.value) }))
    .sort((a, b) => a.beat - b.beat);
}

// Local beatsToSeconds replaced by the shared beatToSeconds from ../tempo.ts.
