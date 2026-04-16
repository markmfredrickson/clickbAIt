#!/usr/bin/env npx tsx
/**
 * section-timing.ts — Estimate section bar counts from beats + Whisper + Genius.
 *
 * Usage:
 *   npx tsx scripts/section-timing.ts <lookup.json> <words.json> <beats.json> --bpm 107
 *
 * Pipeline:
 *   1. Parse Genius sections from lookup.json (section name + first line)
 *   2. Parse Whisper words from words.json (word + timestamp)
 *   3. Parse DBN beats from beats.json (beat times → beat grid)
 *   4. Fuzzy-match each Genius section's first words to Whisper timestamps
 *   5. Snap each section start to the nearest beat
 *   6. Count bars between section starts
 *
 * Output: JSON with section names, start beats, and bar counts.
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// --- Args ---
const args = process.argv.slice(2);
const bpmIdx = args.indexOf("--bpm");
let bpm = 0;
if (bpmIdx !== -1) {
  bpm = parseFloat(args[bpmIdx + 1]);
  args.splice(bpmIdx, 2);
}

const [lookupPath, wordsPath, beatsPath] = args;
if (!lookupPath || !wordsPath || !beatsPath) {
  console.error("Usage: npx tsx scripts/section-timing.ts <lookup> <words.json> <beats.json> --bpm N");
  process.exit(1);
}

// --- Parse Genius sections ---
interface GeniusSection { name: string; firstWords: string[] }

function parseGeniusSections(text: string): GeniusSection[] {
  const sections: GeniusSection[] = [];
  let currentName: string | null = null;
  let firstLine: string | null = null;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    // Find [Section] markers anywhere in line (handles Genius metadata junk)
    const match = trimmed.match(/\[([^\]]+)\]/);
    if (match) {
      const candidate = match[1].toLowerCase();
      const isSection = ["verse", "chorus", "bridge", "intro", "outro",
        "hook", "pre-chorus", "pre chorus", "post-chorus", "refrain",
        "interlude", "solo", "instrumental", "break"].some(kw => candidate.includes(kw));
      if (isSection) {
        if (currentName && firstLine) {
          sections.push({ name: currentName, firstWords: firstLine.toLowerCase().split(/\s+/).slice(0, 5) });
        }
        currentName = match[1];
        firstLine = null;
        continue;
      }
    }
    if (currentName && !firstLine && trimmed && !trimmed.startsWith("Genius:") && !trimmed.startsWith("Sections found:")) {
      firstLine = trimmed;
    }
  }
  if (currentName && firstLine) {
    sections.push({ name: currentName, firstWords: firstLine.toLowerCase().split(/\s+/).slice(0, 5) });
  }
  return sections;
}

// --- Parse Whisper words ---
interface WhisperWord { text: string; startMs: number }

function parseWhisperWords(json: string): WhisperWord[] {
  const data = JSON.parse(json);
  return (data.words as any[])
    .filter((w: any) => w.text !== "♪" && !w.text.startsWith("("))
    .map((w: any) => ({ text: w.text.toLowerCase(), startMs: w.startMs }));
}

// --- Parse beats ---
interface Beat { time: number }

function parseBeats(json: string): Beat[] {
  const data = JSON.parse(json);
  return data.beats as Beat[];
}

// --- Fuzzy match: find Whisper position matching Genius first words ---
// searchAfterMs: only consider matches after this time (ensures sequential matching)
function findSectionStart(firstWords: string[], whisperWords: WhisperWord[], searchAfterMs: number = 0): number | null {
  let bestScore = 0;
  let bestIdx = -1;

  for (let i = 0; i < whisperWords.length - firstWords.length; i++) {
    // Only search after previous section
    if (whisperWords[i].startMs < searchAfterMs) continue;

    let score = 0;
    for (let j = 0; j < firstWords.length; j++) {
      const whisper = whisperWords[i + j].text;
      const genius = firstWords[j];
      // Exact match
      if (whisper === genius) {
        score += 1.0;
      }
      // Prefix match (3+ chars)
      else if (genius.length >= 3 && whisper.startsWith(genius.slice(0, 3))) {
        score += 0.5;
      }
      else if (whisper.length >= 3 && genius.startsWith(whisper.slice(0, 3))) {
        score += 0.5;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  // Require at least 30% of words to match (lower threshold for garbled vocals)
  if (bestScore < firstWords.length * 0.3) return null;
  return bestIdx >= 0 ? whisperWords[bestIdx].startMs : null;
}

// --- Snap time to nearest beat ---
function snapToBeat(timeMs: number, beats: Beat[]): { beatIndex: number; time: number } {
  const timeSec = timeMs / 1000;
  let bestIdx = 0;
  let bestDist = Math.abs(beats[0].time - timeSec);

  for (let i = 1; i < beats.length; i++) {
    const dist = Math.abs(beats[i].time - timeSec);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return { beatIndex: bestIdx, time: beats[bestIdx].time };
}

// --- Main ---
const lookupText = readFileSync(resolve(lookupPath), "utf8");
const wordsJson = readFileSync(resolve(wordsPath), "utf8");
const beatsJson = readFileSync(resolve(beatsPath), "utf8");

const geniusSections = parseGeniusSections(lookupText);
const whisperWords = parseWhisperWords(wordsJson);
const beats = parseBeats(beatsJson);

if (!bpm && beats.length > 10) {
  // Estimate from beat intervals
  const intervals = [];
  for (let i = 1; i < Math.min(100, beats.length); i++) {
    intervals.push(beats[i].time - beats[i - 1].time);
  }
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  bpm = Math.round(60 / mean);
}

const beatsPerBar = 4; // assume 4/4

console.error(`BPM: ${bpm} | ${beats.length} beats | ${whisperWords.length} words | ${geniusSections.length} sections`);
console.error();

interface SectionResult {
  name: string;
  startBeat: number;
  startTime: number;
  bars: number;
  matchedWords: string;
}

const results: SectionResult[] = [];

// Find first beat (intro length)
const firstBeatTime = beats[0]?.time ?? 0;

let searchAfterMs = 0;
for (const gs of geniusSections) {
  const startMs = findSectionStart(gs.firstWords, whisperWords, searchAfterMs);
  if (startMs === null) {
    console.error(`  ✗ No match for [${gs.name}]: "${gs.firstWords.join(" ")}" (searching after ${(searchAfterMs / 1000).toFixed(1)}s)`);
    continue;
  }

  const snapped = snapToBeat(startMs, beats);
  const matchedWordPreview = gs.firstWords.slice(0, 3).join(" ");
  console.error(`  ✓ [${gs.name}] → ${(startMs / 1000).toFixed(1)}s → beat ${snapped.beatIndex} (${snapped.time.toFixed(1)}s) "${matchedWordPreview}..."`);

  results.push({
    name: gs.name,
    startBeat: snapped.beatIndex,
    startTime: snapped.time,
    bars: 0,
    matchedWords: matchedWordPreview,
  });

  // Next section must be after this one
  searchAfterMs = startMs + 5000; // at least 5s later
}

// Deduplicate repeated sections (Genius has multiple [Chorus])
// Keep each occurrence — they map to Chorus 1, Chorus 2, etc.

// Calculate bar counts
for (let i = 0; i < results.length; i++) {
  const start = results[i].startBeat;
  const end = i < results.length - 1 ? results[i + 1].startBeat : beats.length - 1;
  const durationBeats = end - start;
  // Round to nearest multiple of beatsPerBar, minimum 1 bar
  const rawBars = durationBeats / beatsPerBar;
  results[i].bars = Math.max(1, Math.round(rawBars));
}

// Calculate intro bars (beats before first section)
const introBeats = results.length > 0 ? results[0].startBeat : 0;
const introBars = Math.max(4, Math.round(introBeats / beatsPerBar));

console.error();
console.error("Section timing:");
console.error(`  Intro: ${introBars} bars (${introBeats} beats before first section)`);
for (const r of results) {
  console.error(`  ${r.name}: ${r.bars} bars (beat ${r.startBeat}, ${r.startTime.toFixed(1)}s)`);
}

// Assign numbered names for repeated sections
const nameCounts = new Map<string, number>();
const output = {
  bpm,
  beatsPerBar,
  intro: { bars: introBars, beats: introBeats },
  sections: results.map(r => {
    const count = (nameCounts.get(r.name) ?? 0) + 1;
    nameCounts.set(r.name, count);
    const totalForName = results.filter(x => x.name === r.name).length;
    const displayName = totalForName > 1 ? `${r.name} ${count}` : r.name;
    return {
      name: displayName,
      geniusName: r.name,
      startBeat: r.startBeat,
      startTime: r.startTime,
      bars: r.bars,
    };
  }),
};

console.log(JSON.stringify(output, null, 2));
