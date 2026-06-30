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

import type { SongManifest } from "./manifest.js";
import { Curve } from "./curve.js";
import { recordingCurveFromBeats, bridgeTokens, type AlignInput } from "./lyrics-timing.js";
import type {
  LyricsDisplay,
  LyricWord,
  DisplayLine,
  DisplaySection,
} from "./teleprompter/lyrics-display.js";

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
  beats: readonly { time: number }[],
): LyricsDisplay {
  // Recording curve (recording time -> musical beat, with the bar-1 anchor)
  // and the song's constant-tempo curve (beat -> song seconds).
  const recordingCurve = recordingCurveFromBeats(beats, manifest.sources.recording.anchor);
  const songCurve = Curve.constantBpm(manifest.bpm);

  // Resolve each aligned word to its musical beat; keep beats, drop seconds.
  const tokens = bridgeTokens(align, recordingCurve, songCurve);
  const words: LyricWord[] = tokens.map((t) => ({
    text: t.text,
    startBeat: t.startB,
    endBeat: t.endB,
  }));

  // Sections become display labels (beat-only).
  const sections: DisplaySection[] = manifest.sections.map((s) => ({
    name: s.name,
    startBeat: s.b,
    ...(s.cue !== undefined ? { cue: s.cue } : {}),
  }));

  // Slice the authored lines into word ranges by normalized word count, and
  // attribute each line to the section it starts in.
  const lines: DisplayLine[] = [];
  let cursor = 0;
  for (const line of manifest.lyrics.lines) {
    const count = alignWords(line.text).length;
    if (count === 0) continue;
    if (cursor >= words.length) break; // ran out of aligned words
    const start = cursor;
    const end = Math.min(cursor + count, words.length) - 1; // inclusive
    cursor += count;

    // Last section starting at or before this line's first word.
    const lineStartBeat = words[start].startBeat;
    let section: string | undefined;
    for (const s of sections) {
      if (s.startBeat <= lineStartBeat) section = s.name;
      else break;
    }

    lines.push({
      words: [start, end],
      ...(line.tag ? { tag: line.tag } : {}),
      ...(section ? { section } : {}),
    });
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
    slug,
    curve: [...songCurve.anchors],
    words,
    display: { sections, lines },
  };
}
