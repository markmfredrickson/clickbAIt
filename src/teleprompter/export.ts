/**
 * Transform a Song into a SongPayload for the teleprompter browser client.
 * Groups linearized events by section, with lyrics, chords, and timing.
 */

import type { Song } from "../types.js";
import type { LinearEvent } from "../linearize.js";
import type { SongPayload, Section, LyricLine, ChordMark, TempoPoint } from "./types.js";
import { linearize } from "../linearize.js";
import { extractSections } from "../sections.js";

/** Sanitize a string to a safe filename slug. */
export function toSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Generate the canonical slug for a song. */
export function songSlug(song: Song): string {
  const parts = [song.title];
  if (song.artist) parts.push(song.artist);
  return toSlug(parts.join("-"));
}

export function exportSongPayload(song: Song): SongPayload {
  const events = linearize(song);
  const sections = extractSections(song);

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
      seconds: beatsToSeconds(sec.beat, tempoMap),
      durationBeats: sec.durationBeats,
      durationSeconds: beatsToSeconds(sec.beat + sec.durationBeats, tempoMap)
        - beatsToSeconds(sec.beat, tempoMap),
      lyrics,
      chords,
    };
  });

  // Build tempo map with seconds for each tempo change
  const tempoPoints: TempoPoint[] = tempoMap.map((t) => ({
    beat: t.beat,
    seconds: beatsToSeconds(t.beat, tempoMap),
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

function beatsToSeconds(beat: number, tempoMap: TempoEntry[]): number {
  let seconds = 0;
  let prevBeat = 0;
  let bpm = tempoMap[0]?.bpm ?? 120;

  for (const entry of tempoMap) {
    if (entry.beat >= beat) break;
    if (entry.beat > prevBeat) {
      seconds += ((entry.beat - prevBeat) / bpm) * 60;
      prevBeat = entry.beat;
    }
    bpm = entry.bpm;
  }

  seconds += ((beat - prevBeat) / bpm) * 60;
  return seconds;
}
