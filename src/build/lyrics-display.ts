/**
 * Build a `LyricsDisplay` from a song manifest, its alignment, and its beats.
 *
 * The measured input — each word's recording-time ms — comes from
 * `clickbait-audio align`. This routes it through the two curves to land each
 * word on the song's beat grid (see lyrics-timing.ts), keeps beats and drops
 * seconds (the curve reconstructs seconds; the raw ms stay in `align.json`),
 * and groups the words into the authored lines and sections.
 *
 * The core is pure — it takes already-parsed inputs — so it is easy to test and
 * cheap to re-run after a bar-1 anchor change. A file-reading wrapper lives in
 * the CLI that calls it.
 */

import { sectionStarts, type SongManifest } from "../manifest.js";
import { Curve } from "../core/curve.js";
import { beatMapCurve } from "../core/beat-map.js";
import { bridgeTokens, type AlignInput } from "./lyrics-timing.js";
import type {
  LyricsDisplay,
  LyricWord,
  DisplayLine,
  DisplaySection,
  MeterSegment,
} from "../teleprompter/lyrics-display.js";

/**
 * Split text into words the same way `clickbait-audio align` normalizes it:
 * letters and apostrophes belong to a word, everything else is a separator
 * (so "a-marchin'" is two words, "they're" is one). Used to count how many
 * aligned words each authored line owns.
 */
export function alignWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z']+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Lowercase, non-alphanumeric runs to hyphens. */
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function buildLyricsDisplay(
  manifest: SongManifest,
  align: AlignInput,
): LyricsDisplay {
  // Recording curve (recording time -> musical beat, from the beat-map) and the
  // song's constant-tempo curve (beat -> song seconds). The pre-roll sets the
  // curve's t0: the downbeat (beat 0) sits `preRollBars` bars into the
  // show-track timeline, so the count-in is at negative beats / positive time
  // (see docs/timing-frames.md). Word beats are downbeat-relative regardless —
  // they come from the recording curve — so only t0 (the song-time origin)
  // moves.
  const recordingCurve = beatMapCurve(manifest.sources.recording.beatMap, manifest.bpm);
  const preRollSeconds = (manifest.preRollBars * manifest.timeSignature[0] * 60) / manifest.bpm;
  const songCurve = Curve.constantBpm(manifest.bpm, { t0: preRollSeconds });

  // Resolve each aligned word to its musical beat; keep beats, drop seconds.
  const tokens = bridgeTokens(align, recordingCurve, songCurve);
  const words: LyricWord[] = tokens.map((t) => ({
    text: t.text,
    startBeat: t.startB,
    endBeat: t.endB,
  }));

  // Sections become display labels (beat-only). Start beats are inferred from
  // section order + length, not authored.
  const starts = sectionStarts(manifest.sections, manifest.timeSignature);
  const sections: DisplaySection[] = manifest.sections.map((s, i) => ({
    name: s.name,
    startBeat: starts[i],
    ...(s.cue !== undefined ? { cue: s.cue } : {}),
  }));

  // Meter map, in REAPER measure order, so the client can turn measure.beat OSC
  // into a continuous beat even when a section changes meter (e.g. a 2/4
  // pickup). Walk sections accumulating measures + beats, emitting a segment
  // only where beats-per-bar changes. Only emitted when the meter isn't
  // constant — a single-meter song omits it and the client uses timeSignature.
  const defaultBpb = manifest.timeSignature[0];
  const meterMap: MeterSegment[] = [];
  let measure = 1;
  let beatsAcc = 0;
  for (const s of manifest.sections) {
    const beatsPerBar = s.timeSignature?.[0] ?? defaultBpb;
    const last = meterMap[meterMap.length - 1];
    if (!last || last.beatsPerBar !== beatsPerBar) {
      meterMap.push({ fromMeasure: measure, beatsPerBar, beatsBefore: beatsAcc });
    }
    measure += s.bars;
    beatsAcc += s.bars * beatsPerBar;
  }
  const meterChanges = meterMap.length > 1;

  // Walk sections in order and slice their lines' words off the aligned
  // stream (word counts match because the aligner was fed these same lines in
  // this same order). Section membership is EXPLICIT — the containing section —
  // so a pickup sung before its section's downbeat still groups under it,
  // rather than being guessed into the previous section from its beat.
  const lines: DisplayLine[] = [];
  let cursor = 0;
  for (const section of manifest.sections) {
    for (const line of section.lines ?? []) {
      const count = alignWords(line.text).length;
      if (count === 0) continue;
      if (cursor >= words.length) break; // ran out of aligned words
      const start = cursor;
      const end = Math.min(cursor + count, words.length) - 1; // inclusive
      cursor += count;
      lines.push({
        words: [start, end],
        ...(line.tag ? { tag: line.tag } : {}),
        section: section.name,
      });
    }
  }

  const slug = manifest.artist
    ? `${slugify(manifest.title)}-${slugify(manifest.artist)}`
    : slugify(manifest.title);

  return {
    schema: "clickbait/lyrics-display@1",
    title: manifest.title,
    ...(manifest.artist ? { artist: manifest.artist } : {}),
    ...(manifest.key ? { key: manifest.key } : {}),
    bpm: manifest.bpm,
    timeSignature: manifest.timeSignature,
    slug,
    curve: [...songCurve.anchors],
    ...(meterChanges ? { meterMap } : {}),
    words,
    display: { sections, lines },
  };
}
