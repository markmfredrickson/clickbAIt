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

import { sectionStarts, type SongManifest, type Clip } from "../manifest.js";
import { Curve } from "../core/curve.js";
import { beatMapCurve, beatMapToBeats } from "../core/beat-map.js";
import { downbeatFrame } from "../core/timing-frame.js";
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

/** A played audio clip's place on the timeline + where its words start in the
 *  flattened word list. Used to re-anchor line assignment at clip boundaries. */
export interface ClipSegment {
  startBeat: number;
  endBeat: number;
  firstWord: number; // index into `words` of this clip's first word
}
export interface ClipMapping {
  words: LyricWord[];
  segments: ClipSegment[];
}

/**
 * Map aligned words onto the timeline THROUGH the clip arrangement, so lyrics
 * follow the rearranged audio. Mirrors the clip walk in manifest-to-song: each
 * audio clip plays source `[from, from+seconds]` at `cursorBeat…`; silence just
 * advances the cursor. A word (keyed by its SOURCE time) is emitted once per clip
 * whose window contains it — so a replayed region's words appear again at the
 * replay's beats. `offset` is the timeline origin (the beat-map's first beat).
 * Also returns each played clip's timeline range + first-word index, so line
 * assignment can re-anchor per clip (a replay's words aren't confused with the
 * original's). One stream in; loop over per-voice alignments for streams later.
 */
export function clipAwareWords(
  align: AlignInput,
  recordingCurve: Curve,
  clips: Clip[],
  offset: number,
  bpm: number,
): ClipMapping {
  const bps = bpm / 60;
  const words: LyricWord[] = [];
  const segments: ClipSegment[] = [];
  let cursorBeat = offset;
  for (const clip of clips) {
    if ("silence" in clip) {
      cursorBeat += clip.silence * bps;
      continue;
    }
    const to = clip.from + clip.seconds;
    const fromBeat = recordingCurve.toBeat(clip.from);
    const segStart = cursorBeat;
    const firstWord = words.length;
    for (const word of align.words) {
      const s = word.startMs / 1000;
      if (s < clip.from || s >= to) continue; // word's onset lies outside this clip
      words.push({
        text: word.text,
        startBeat: cursorBeat + (recordingCurve.toBeat(s) - fromBeat),
        endBeat: cursorBeat + (recordingCurve.toBeat(word.endMs / 1000) - fromBeat),
      });
    }
    cursorBeat += recordingCurve.toBeat(to) - fromBeat;
    segments.push({ startBeat: segStart, endBeat: cursorBeat, firstWord });
  }
  return { words, segments };
}

export function buildLyricsDisplay(
  manifest: SongManifest,
  align: AlignInput,
  opts: { renderOffsetBeats?: number } = {},
): LyricsDisplay {
  // Recording curve (recording time -> musical beat, from the beat-map) and the
  // song's constant-tempo curve (beat -> song seconds). Word beats are
  // downbeat-relative regardless — they come from the recording curve — so only
  // t0 (the song-time ORIGIN) moves; changing it never shifts a word's beat.
  //
  // t0 = where the downbeat (beat 0) sits on the CURVE's time axis. The bundle
  // player is the only consumer of this time axis (it maps <audio>.currentTime →
  // beat; live mode uses REAPER's /beat/str, ignoring time). The rendered mix
  // starts at project time 0, which is `renderOffsetBeats` bars of slug/pre-roll
  // BEFORE the downbeat — so anchor t0 there and the bundle emits the same beats
  // as live. Without a render offset (e.g. the standalone lyrics CLI), fall back
  // to preRollBars. See docs/timing-frames.md.
  const recordingCurve = beatMapCurve(manifest.sources.recording.beatMap, manifest.bpm);
  const offsetBeats = opts.renderOffsetBeats ?? manifest.preRollBars * manifest.timeSignature[0];
  // Same downbeat-origin conversion the RPP uses for PROJOFFS, so the bundle
  // curve and the live bar grid can't disagree on where beat 0 is.
  const { downbeatSeconds } = downbeatFrame(offsetBeats, manifest.bpm, manifest.timeSignature[0]);
  const songCurve = Curve.constantBpm(manifest.bpm, { t0: downbeatSeconds });

  // Resolve each aligned word to its musical beat; keep beats, drop seconds.
  // When the stems are assembled from clips, the recording is rearranged on the
  // timeline — so map words THROUGH the clip walk (a replayed region's words
  // appear at both spots). Otherwise the recording plays linearly and each word
  // lands at its recording-curve beat.
  const clips = manifest.sources.stems?.clips;
  let words: LyricWord[];
  let segments: ClipSegment[] | undefined;
  if (clips && clips.length > 0) {
    const { offset } = beatMapToBeats(manifest.sources.recording.beatMap, manifest.bpm);
    ({ words, segments } = clipAwareWords(align, recordingCurve, clips, offset, manifest.bpm));
  } else {
    words = bridgeTokens(align, recordingCurve, songCurve).map((t) => ({
      text: t.text,
      startBeat: t.startB,
      endBeat: t.endB,
    }));
  }

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
  let prevSeg = -1;
  for (let si = 0; si < manifest.sections.length; si++) {
    const section = manifest.sections[si];
    // With clips, re-anchor the cursor when a section moves into a new played
    // clip — so a replayed clip's lines draw from ITS words, not leftover
    // (unauthored ad-lib) words trailing the previous clip. Sections within one
    // clip keep slicing sequentially (pickups intact). No clips → never resets.
    if (segments) {
      const secStart = starts[si];
      // A section belongs to the LAST clip that starts at (or within a beat
      // before) its downbeat. An exact range check can't be trusted: clip
      // boundaries come from the recording curve while section starts come from
      // bar counts, so a boundary meant to coincide with a section can land a
      // fraction of a beat off (e.g. clip start 240.0006 vs section start 240) —
      // which would silently file the section under the previous clip.
      let seg = 0;
      for (let i = 0; i < segments.length; i++) {
        if (segments[i].startBeat <= secStart + 0.5) seg = i;
      }
      if (seg !== prevSeg) {
        cursor = segments[seg].firstWord;
        prevSeg = seg;
      }
    }
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
