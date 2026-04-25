#!/usr/bin/env node
/**
 * Generate a DSongL .ts file for a song from its analysis sidecars.
 *
 * Inputs (all read from songDir):
 *   - source.analysis.json        (full-mix BPM/onsets)
 *   - source.m4a.beats.json       (DBN beat grid — source of truth for timing)
 *   - stems/source_vocals.align.json   (wav2vec2 forced alignment: line/word timings)
 *   - <slug>.lookup.json          (Genius section markers, Deezer BPM cross-check)
 *
 * Output: <songDir>/<slug>.ts  (DSongL song definition)
 *
 * Usage:
 *   node scripts/build-dsongl.mjs <songDir> <slug> "<title>" "<artist>" [key]
 */

import fs from 'node:fs';
import path from 'node:path';

const [, , songDir, slug, title, artist, key] = process.argv;
if (!songDir || !slug || !title || !artist) {
  console.error('usage: build-dsongl.mjs <songDir> <slug> "<title>" "<artist>" [key]');
  process.exit(1);
}

const analysis = JSON.parse(fs.readFileSync(path.join(songDir, 'source.analysis.json'), 'utf8'));
const beatsDoc = JSON.parse(fs.readFileSync(path.join(songDir, 'source.m4a.beats.json'), 'utf8'));
const align = JSON.parse(fs.readFileSync(path.join(songDir, 'stems/source_vocals.align.json'), 'utf8'));
const lookupText = fs.readFileSync(path.join(songDir, `${slug}.lookup.json`), 'utf8');

// Keep full precision — REAPER's beat grid stays tighter with exact BPM.
// Humans read it as "~107 BPM" regardless; machines benefit from the decimals.
const rawBpm = Number(beatsDoc.bpm ?? analysis.bpm);
// Allow caller to override via env (for half-time / double-time folds).
// Set CLICKBAIT_BPM_FOLD=half to divide by 2 (e.g. Save Me detected at 143, real 71.5).
const fold = process.env.CLICKBAIT_BPM_FOLD;
const bpm = Number(((fold === 'half' ? rawBpm / 2 : fold === 'double' ? rawBpm * 2 : rawBpm)).toFixed(4));
let beatArr = beatsDoc.beats; // [{time, strength}]

// --- Find the real downbeat of bar 1 ---
// Conceptual note: the DBN beat tracker produces a *beat pulse* — where each
// beat lands — but says nothing about which beat is the drummer's "one."
// Beat pulse and bar numbering are orthogonal problems. This block does the
// bar-numbering step: pick which beat in the pulse array is bar-1-beat-1.
//
// Priority order:
//   1. Explicit override in `<songDir>/bar-one.txt` (one number: source-file
//      time in seconds of bar 1's downbeat). This is the escape hatch — 30
//      seconds of human listening gets any song perfect.
//   2. Drum-stem strong-onset heuristic (works for most drum-forward songs).
//   3. Fall back to `beats[0]` (pulse start) — worst option, but valid for
//      songs with no audible pickup.
let barOneBeatIdx = 0;
const barOneFile = path.join(songDir, 'bar-one.txt');
if (fs.existsSync(barOneFile)) {
  const overrideTime = Number(fs.readFileSync(barOneFile, 'utf8').trim());
  if (Number.isFinite(overrideTime)) {
    let bestIdx = 0, bestDist = Infinity;
    for (let i = 0; i < beatArr.length; i++) {
      const d = Math.abs(beatArr[i].time - overrideTime);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    barOneBeatIdx = bestIdx;
    console.error(`  downbeat anchor: override from bar-one.txt (${overrideTime}s) → DBN beat ${bestIdx} @ ${beatArr[bestIdx].time.toFixed(2)}s`);
  }
}
// Drum-anchor heuristic disabled. Default: source beats[0] maps to REAPER
// bar 5 beat 1 (start of user-authored music, right after the 4-bar slug).
//
// Per-song override: CLICKBAIT_BEAT_ZERO_OFFSET=N shifts beats[0] back by N
// beats, so N=1 lands beats[0] on REAPER 4.4 (last beat of the count-in
// bar — appropriate when beats[0] is a pickup). Everything else flows:
// beats[1] lands on REAPER 5.1, lyrics/sections are computed from a
// beatArr whose new index 0 is the original beats[N], and the audio node
// gets `offset: -N` so the item is placed N beats earlier in the project.
// CLICKBAIT_BEAT_ZERO_OFFSET — number of beats (in the effective, post-fold
// grid) by which to push beats[0] EARLIER in the REAPER timeline. N=1 →
// beats[0] on REAPER 4.4 instead of 5.1; N=3 → beats[0] on REAPER 4.2. Used
// when the song has a pickup and the drum-anchor heuristic lands bar 1 too
// late. The shift applies to both the audio offset (stems slide earlier)
// and the lyric/section positioning (so synced content stays aligned).
const beatZeroOffset = Math.max(0, Math.floor(Number(process.env.CLICKBAIT_BEAT_ZERO_OFFSET || 0)));
if (barOneBeatIdx > 0) {
  console.error(`  downbeat anchor: drum-stem onset → DBN beat ${barOneBeatIdx} @ ${beatArr[barOneBeatIdx].time.toFixed(2)}s (was ${beatArr[0].time.toFixed(2)}s)`);
  // Use the drum-hit beat directly as bar 1. Don't floor to a DBN-grid
  // "bar boundary" — DBN's beat numbering isn't aligned to musical bars, so
  // snapping tends to land on the wrong side of the drum hit. For drum-forward
  // songs the first drum hit IS the downbeat (user-confirmed on Like a Stone).
  // Bass-intro songs (e.g. Seven Nation Army) where the drum isn't bar 1 need
  // a manual override — address case-by-case.
  beatArr = beatArr.slice(barOneBeatIdx);
}

// Apply BPM fold if requested. This must happen *after* the trim so the fold
// operates on the bar-1-anchored grid.
// Optional phase for half-fold: CLICKBAIT_BPM_PHASE=1 keeps odd-indexed beats
// (useful when the downbeat phase landed on the "off" beat after folding).
const phase = Number(process.env.CLICKBAIT_BPM_PHASE || 0);
if (fold === 'half') {
  beatArr = beatArr.filter((_, i) => i % 2 === phase);
} else if (fold === 'double') {
  const doubled = [];
  for (let i = 0; i < beatArr.length; i++) {
    doubled.push(beatArr[i]);
    if (i + 1 < beatArr.length) {
      doubled.push({
        time: (beatArr[i].time + beatArr[i + 1].time) / 2,
        strength: 0,
      });
    }
  }
  beatArr = doubled;
}

// Write the single "effective" beats file that captures both trim and fold.
// This is the grid REAPER will use for stretch markers, and it must match
// what the generator uses for lyric/section positioning.
const beatsFileName = 'source.m4a.beats.effective.json';
{
  const foldedBpm =
    fold === 'half' ? beatsDoc.bpm / 2 :
    fold === 'double' ? beatsDoc.bpm * 2 :
    beatsDoc.bpm;
  fs.writeFileSync(
    path.join(songDir, beatsFileName),
    JSON.stringify({ ...beatsDoc, bpm: foldedBpm, beats: beatArr }, null, 2),
  );
}
// preRollSeconds = 0 by default. We no longer auto-trim audio to a detected
// downbeat — that caused more problems than it solved (cut beats on some
// songs, left silence on others). Full source audio plays from the top; the
// user can trim in REAPER if they want. A `bar-one.txt` override still
// produces a non-zero preRoll for songs where the user explicitly wants the
// pre-intro dead-air trimmed.
const preRollSeconds = 0;
const beatsPerBar = 4;

// Beats used for lyric/section positioning. If beatZeroOffset > 0, skip the
// first N beats: their content plays BEFORE DSongL beat 0 in project time
// (via a negative audio offset on the emitted nodes), so DSongL beat 0
// should correspond to beatArr[beatZeroOffset], not beatArr[0].
const beatArrForLyrics = beatArr.slice(beatZeroOffset);

/** Time (s) → nearest beat index in beatArrForLyrics */
function nearestBeat(tSec) {
  const arr = beatArrForLyrics;
  let lo = 0, hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].time < tSec) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && (tSec - arr[lo - 1].time) < (arr[lo].time - tSec)) return lo - 1;
  return lo;
}

// --- Parse Genius sections from lookup text ---
// Block between "---lyrics-raw---" and "---end-lyrics-raw---".
// Section headers look like "[Verse 1]" on their own line.
const lyricsBlock = lookupText.split('---lyrics-raw---')[1]?.split('---end-lyrics-raw---')[0] ?? '';

const sections = []; // [{ name, lineIndices: [globalLineIdx] }]
let cur = null;
let globalLineIdx = 0;
for (const raw of lyricsBlock.split('\n')) {
  const trimmed = raw.trim();
  if (!trimmed) continue;
  const hdr = trimmed.match(/^\[([^\]]+)\]$/);
  if (hdr) {
    cur = { name: hdr[1].trim(), lineIndices: [] };
    sections.push(cur);
    continue;
  }
  if (cur) {
    cur.lineIndices.push(globalLineIdx);
    globalLineIdx++;
  }
}

if (sections.length === 0) {
  console.error('No section headers found in lookup; cannot build DSongL.');
  process.exit(2);
}

// --- Align line → beat ---
// startBeat anchors where a lyric event is placed; endBeat anchors where a
// section's tail ends (the last word runs well past its own start).
const lineStartBeats = align.lines.map(l => nearestBeat(l.startMs / 1000));
const lineEndBeats = align.lines.map(l => nearestBeat(l.endMs / 1000));
// Defensive: align may not have exactly as many lines as Genius has (differences
// in line wrapping, blank lines, etc). Truncate to the min.
const lineCount = Math.min(lineStartBeats.length, globalLineIdx);

// --- Per-section: startBar (snap first-lyric beat down to bar), length from next section ---
// Pass 1: first lyric beat per non-empty section
const sectionFirstBeat = sections.map(s => {
  const valid = s.lineIndices.filter(i => i < lineCount);
  if (!valid.length) return null;
  return Math.min(...valid.map(i => lineStartBeats[i]));
});

// Find next non-empty section's first-beat → current section's end
const nextNonEmptyFirstBeat = (idx) => {
  for (let j = idx + 1; j < sections.length; j++) {
    if (sectionFirstBeat[j] !== null) return sectionFirstBeat[j];
  }
  return null;
};

// Song-end beat = last beat in beats.json, rounded up to next bar
const songEndBeat = Math.ceil((beatArr.length - 1) / beatsPerBar) * beatsPerBar;

// Per-section: last-lyric END beat (for "natural length" estimation).
// Using endBeat (when the last word finishes) rather than startBeat so the
// section's tail covers the final sung word's full duration — e.g. "alone"
// held for several beats past its start.
const sectionLastBeat = sections.map(s => {
  const valid = s.lineIndices.filter(i => i < lineCount);
  if (!valid.length) return null;
  return Math.max(...valid.map(i => lineEndBeats[i]));
});

// --- Three-pass layout ---
// Pass A: every Genius section gets a "natural" span — non-empty ones from
//         first-lyric-bar to last-lyric-bar + tail; empty ones are placeholders.
// Pass B: walk pairs, preserving Genius sections (including empty ones) and
//         inserting SYNTHETIC instrumental sections wherever a gap of >=1 bar
//         exists between consecutive Genius sections (or before the first /
//         after the last). Naming based on context of neighbors.
// Pass C: assemble final ranges with contiguous bar layout.
// Tail after the last word *ends*. Small now because `sectionLastBeat` already
// accounts for how long the last word is held; we just want to land on the
// next bar boundary, not add another full bar of silence.
const TAIL_BEATS = 1;

/** Bayesian-ish snap of a raw bar-count to a likely musical length.
 *
 *  Pop/rock song sections very strongly prefer multiples of 4 (especially 8
 *  and 16), so we treat that as a prior and combine it with a data penalty
 *  proportional to how far we'd have to move from the measured length.
 *
 *  With the default coefficients, raw lengths within 1 bar of a multiple of
 *  4 snap to it; unusual lengths (e.g. 7-bar phrases like Dani California)
 *  are kept when the data disagrees by more than the prior's weight. */
function snapBars(raw) {
  if (raw <= 0) return 1;
  const DATA_PENALTY = 0.7;      // per bar of delta from raw
  const BONUS_MULT_16 = 2.0;
  const BONUS_MULT_8 = 1.5;
  const BONUS_MULT_4 = 1.0;
  // Scan a window of candidate bar-counts around raw.
  let best = raw;
  let bestScore = 0; // raw → delta=0, bonus=0 unless raw itself is a mult of 4
  if (raw % 16 === 0) bestScore = BONUS_MULT_16;
  else if (raw % 8 === 0) bestScore = BONUS_MULT_8;
  else if (raw % 4 === 0) bestScore = BONUS_MULT_4;
  for (let delta = -3; delta <= 3; delta++) {
    const cand = raw + delta;
    if (cand <= 0) continue;
    let bonus = 0;
    if (cand % 16 === 0) bonus = BONUS_MULT_16;
    else if (cand % 8 === 0) bonus = BONUS_MULT_8;
    else if (cand % 4 === 0) bonus = BONUS_MULT_4;
    const score = -DATA_PENALTY * Math.abs(delta) + bonus;
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  return best;
}
const MIN_SYNTH_BARS = 2; // don't insert synthetic sections for tiny gaps

const natural = sections.map((s, i) => {
  const firstBeat = sectionFirstBeat[i];
  const lastBeat = sectionLastBeat[i];
  if (firstBeat === null) return { empty: true, fromGenius: true };
  const startBeat = Math.floor(firstBeat / beatsPerBar) * beatsPerBar;
  const rawEnd = lastBeat + TAIL_BEATS;
  const endBeatRaw = Math.ceil(rawEnd / beatsPerBar) * beatsPerBar;
  const rawBars = (endBeatRaw - startBeat) / beatsPerBar;
  const snappedBars = snapBars(rawBars);
  const endBeat = startBeat + snappedBars * beatsPerBar;
  return {
    empty: false,
    fromGenius: true,
    startBeat,
    endBeat,
    rawBars,
    snappedBars,
  };
});

/** Classify the name of a synthetic instrumental section based on neighbors.
 *  prev/next are Genius section names, or null if at the song boundary. */
function synthName(prev, next) {
  const isChorus = (n) => n && /chorus/i.test(n);
  const isVerse = (n) => n && /verse/i.test(n);
  const isBridge = (n) => n && /bridge/i.test(n);
  if (prev === null) return 'Intro';
  if (next === null) return 'Outro';
  if (isChorus(prev)) return 'Post-Chorus';
  if (isChorus(next)) return 'Pre-Chorus';
  if (isBridge(prev) || isBridge(next)) return 'Break';
  if (isVerse(prev) && isVerse(next)) return 'Instrumental';
  return 'Instrumental';
}

// Find first non-empty section's start; anything before that is a synthetic Intro.
const firstNonEmptyIdx = natural.findIndex(n => !n.empty);
const lastNonEmptyIdx = (() => {
  for (let i = natural.length - 1; i >= 0; i--) if (!natural[i].empty) return i;
  return -1;
})();

// Build a merged list: for each position, decide whether to keep, extend, or insert synth.
const raw = []; // [{ name, startBeat, endBeat, lineIndices, synthetic }]

// (1) Pre-intro. If the first non-empty Genius section is already named
//     "Intro" (or similar), absorb the pre-section silence into it instead
//     of inserting a synthetic Intro that gets buried next to the Genius one.
if (firstNonEmptyIdx >= 0) {
  const firstGenius = sections[firstNonEmptyIdx];
  const firstStart = natural[firstNonEmptyIdx].startBeat;
  if (firstStart >= MIN_SYNTH_BARS * beatsPerBar) {
    if (/^intro/i.test(firstGenius.name)) {
      natural[firstNonEmptyIdx].startBeat = 0;
    } else {
      raw.push({
        name: 'Intro',
        startBeat: 0,
        endBeat: firstStart,
        lineIndices: [],
        synthetic: true,
      });
    }
  }
}

let cursor = raw.length ? raw[raw.length - 1].endBeat : 0;
for (let i = 0; i < sections.length; i++) {
  const s = sections[i];
  const n = natural[i];

  // Find the next non-empty Genius section (its natural start anchors the gap end)
  const nextNonEmpty = natural.slice(i + 1).find(x => !x.empty);

  let startBeat, endBeat;
  if (!n.empty) {
    startBeat = Math.max(n.startBeat, cursor);
    // For a Genius section, end = natural end (last lyric + tail), bar-aligned.
    endBeat = Math.max(n.endBeat, startBeat + beatsPerBar);
  } else {
    // Empty Genius section: treated as synthetic from cursor to next non-empty (or songEnd)
    startBeat = cursor;
    endBeat = nextNonEmpty ? nextNonEmpty.startBeat : songEndBeat;
    if (endBeat <= startBeat) endBeat = startBeat + beatsPerBar;
  }

  raw.push({
    name: s.name,
    startBeat,
    endBeat,
    lineIndices: s.lineIndices.filter(li => li < lineCount),
    synthetic: false,
  });
  cursor = endBeat;

  // If the NEXT Genius section is an empty one, let it absorb this gap —
  // don't insert a synthetic that would squeeze the Genius-labeled empty.
  const nextGeniusIsEmpty = (i + 1 < sections.length) && natural[i + 1].empty;

  // Gap between this section's end and the next Genius section's start → synthetic
  if (!nextGeniusIsEmpty && nextNonEmpty && nextNonEmpty.startBeat > cursor + (MIN_SYNTH_BARS - 1) * beatsPerBar) {
    const gapEnd = nextNonEmpty.startBeat;
    const prevName = s.name;
    // Next section's name (first non-empty after this one)
    const nextName = (() => {
      for (let j = i + 1; j < sections.length; j++) {
        if (!natural[j].empty) return sections[j].name;
      }
      return null;
    })();
    raw.push({
      name: synthName(prevName, nextName),
      startBeat: cursor,
      endBeat: gapEnd,
      lineIndices: [],
      synthetic: true,
    });
    cursor = gapEnd;
  }
}

// (3) Outro. If the last non-empty Genius section is already named "Outro"
//     / "Ending" / "End", extend it to song-end rather than append a redundant
//     synthetic Outro after it.
if (cursor < songEndBeat - (MIN_SYNTH_BARS - 1) * beatsPerBar) {
  const lastNonEmptyRaw = [...raw].reverse().find(r => !r.synthetic && r.lineIndices.length);
  if (lastNonEmptyRaw && /^(outro|ending|end)\b/i.test(lastNonEmptyRaw.name)) {
    lastNonEmptyRaw.endBeat = songEndBeat;
  } else {
    raw.push({
      name: 'Outro',
      startBeat: cursor,
      endBeat: songEndBeat,
      lineIndices: [],
      synthetic: true,
    });
  }
}

// Convert to sectionRanges with bar units
const sectionRanges = raw.map(r => ({
  name: r.name,
  startBar: r.startBeat / beatsPerBar,
  barCount: (r.endBeat - r.startBeat) / beatsPerBar,
  lineIndices: r.lineIndices,
  synthetic: r.synthetic,
}));

// --- Emit DSongL ---
function esc(s) { return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }

// Audio paths are resolved by the generator relative to the repo root, so
// emit them as "songs/<artist>/..." not just "stems/..." (which would be
// interpreted as cwd-relative and break when run from the repo root).
const songDirRel = songDir.replace(/^\.?\//, '').replace(/\/$/, '');
const stemsDirRel = `${songDirRel}/stems`;
const beatsFileRel = `${songDirRel}/${beatsFileName}`;

const spansCode = sectionRanges.map((sr) => {
  const startBeat = sr.startBar * beatsPerBar;
  const sectionLen = sr.barCount * beatsPerBar;
  const lines = sr.lineIndices.map(li => {
    const beat = lineStartBeats[li];
    // Genius assigns the lyric to this section, so keep it even if the
    // alignment beat falls outside the section's [start, end) window — that
    // happens when section bounds get bumped (cursor collisions, snapBars,
    // tail overrun). Clamp into the section instead of silently dropping.
    const beatInSection = Math.max(0, Math.min(sectionLen - 1, beat - startBeat));
    const text = esc(align.lines[li].text);
    return `      lyric("${text}", beats(${beatInSection}), "Lead Vocal"),`;
  }).filter(Boolean);
  const body = lines.length
    ? `, [\n${lines.join('\n')}\n    ]`
    : '';
  return `    span("${sr.name}", bars(${sr.barCount}), { cue: true }${body}),`;
}).join('\n');

// Audio node options. If beatZeroOffset > 0, place audio N beats earlier
// in the project so source beats[0] lands on REAPER 5.1 - N beats.
const audioOptsParts = [`beatsFile: "${beatsFileRel}"`];
if (beatZeroOffset > 0) audioOptsParts.unshift(`offset: ${-beatZeroOffset}`);
const audioOpts = audioOptsParts.join(', ');

const optsLines = [
  `artist: "${esc(artist)}"`,
  key ? `key: "${esc(key)}"` : null,
  `timeSignature: [4, 4]`,
  `preRollSeconds: ${preRollSeconds}`,
].filter(Boolean).join(', ');

const ts = `import { song, seq, span, audio, lyric, bars, beats } from "../../src/dsongl/index.js";

// ${title} — ${artist}
// ${bpm} BPM${key ? `, ${key}` : ''}, 4/4
// Auto-generated by scripts/build-dsongl.mjs from align.json + beats.json + Genius structure.

export default song("${esc(title)}", ${bpm}, { ${optsLines} },
  seq(
${spansCode}
  ),
  audio("Bass",   "${stemsDirRel}/source_bass.wav",   { ${audioOpts} }),
  audio("Drums",  "${stemsDirRel}/source_drums.wav",  { ${audioOpts} }),
  audio("Other",  "${stemsDirRel}/source_other.wav",  { ${audioOpts} }),
  audio("Vocals", "${stemsDirRel}/source_vocals.wav", { ${audioOpts} }),
);
`;

const outPath = path.join(songDir, `${slug}.ts`);
fs.writeFileSync(outPath, ts);
console.error(`wrote ${outPath}`);
console.error(`  bpm=${bpm}  preRoll=${preRollSeconds}s  sections=${sectionRanges.length}  lines=${lineCount}`);
sectionRanges.forEach((sr, idx) => {
  const tag = sr.synthetic ? ' *' : '  ';
  const snapNote = (() => {
    if (sr.synthetic) return '';
    const n = natural.find(nn => !nn.empty && nn.startBeat === sr.startBar * beatsPerBar);
    if (!n) return '';
    if (n.rawBars !== n.snappedBars) return `  [snap ${n.rawBars}→${n.snappedBars}]`;
    return '';
  })();
  console.error(`  ${tag} ${sr.name.padEnd(20)} bar ${String(sr.startBar + 1).padStart(3)}–${String(sr.startBar + sr.barCount).padStart(3)}  (${sr.barCount} bars, ${sr.lineIndices.length} lyrics)${snapNote}`);
});
console.error('  (* = synthetic, inferred from gaps; [snap a→b] = Bayesian bar-length prior applied)');
