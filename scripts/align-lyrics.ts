/**
 * align-lyrics — match published lyric lines to Whisper word-level timestamps.
 *
 * Usage:
 *   npx tsx scripts/align-lyrics.ts <lookup.json> <words.json> <beats.json> <output.json>
 *
 * Inputs:
 *   lookup.json — Genius lookup text with [Section] markers (plain text, not JSON
 *                 despite the name)
 *   words.json  — Whisper per-word transcription with startMs/endMs
 *   beats.json  — beat grid + BPM (we read beats[] + bpm)
 *
 * Output:
 *   lyrics.json — { alignments: [{section, line, startMs, beat, confidence}, ...],
 *                   unmatched: [{section, line, reason}, ...] }
 *
 * Requires ANTHROPIC_API_KEY in the environment.
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { z } from "zod";
import { callHaiku, formatUsage } from "../src/haiku-delegate.js";

const AlignedLine = z.object({
  section: z.string().describe("Section name as it appears in the Genius markers (e.g. 'Verse 1')"),
  line: z.string().describe("The canonical lyric line from Genius, verbatim"),
  startMs: z.number().describe("First-matched Whisper word's startMs"),
  beat: z.number().describe("Absolute beat position in the song: (startMs/1000) * bpm / 60"),
  confidence: z.number().min(0).max(1).describe("0-1 match quality; 1 = exact, 0.5 = phonetic near-match, <0.3 = tenuous"),
});

const UnmatchedLine = z.object({
  section: z.string(),
  line: z.string(),
  reason: z.string().describe("Why this line could not be confidently aligned"),
});

const ResultSchema = z.object({
  alignments: z.array(AlignedLine),
  unmatched: z.array(UnmatchedLine),
});

const args = process.argv.slice(2);
if (args.length < 4) {
  console.error("Usage: npx tsx scripts/align-lyrics.ts <lookup.json> <words.json> <beats.json> <output.json>");
  process.exit(1);
}
const [lookupPath, wordsPath, beatsPath, outPath] = args;

const lookupText = readFileSync(resolve(lookupPath), "utf-8");
const wordsJson = JSON.parse(readFileSync(resolve(wordsPath), "utf-8"));
const beatsJson = JSON.parse(readFileSync(resolve(beatsPath), "utf-8"));

const bpm = typeof beatsJson.bpm === "number" ? beatsJson.bpm : null;
if (bpm === null) {
  console.error(`No 'bpm' field in ${beatsPath}`);
  process.exit(2);
}

// Extract the raw Genius block. The CLI wraps it in --- markers; fall back to
// the whole file if the markers aren't present (older lookup output).
const rawMatch = lookupText.match(/---lyrics-raw---\s*([\s\S]*?)\s*---end-lyrics-raw---/);
const lyricsPortion = rawMatch ? rawMatch[1].trim() : lookupText.trim();

const SYSTEM = `You are a lyric extraction + alignment tool.

You'll receive:
  1. Raw text scraped from a lyrics page. It may contain [Section] markers, editorial annotations, or stray formatting. Identify the actual lyric content — ignore annotation prose, metadata, and anything that isn't a lyric line.
  2. A Whisper word-level transcription of an audio recording of the same song.
  3. A BPM value for the song.

Do two things in one pass:

A. Extract the canonical lyrics as a sequence of (section, line) pairs:
   - Use the [Section] markers to label sections. Preserve their names exactly as written (e.g. "Verse 1", "Chorus", "Bridge", "Outro").
   - Split lines on newlines. Preserve each line verbatim.
   - Drop anything that isn't a lyric line: annotation prose, page chrome, parenthetical editorial notes. When in doubt, prefer to include rather than drop.
   - If a song has lyrics before any [Section] marker, group them into a synthetic "Verse 1".

B. For each extracted line, align it to the Whisper transcription:
   - Find the best-matching consecutive sequence of Whisper words (fuzzy/phonetic matching is expected — Whisper has errors).
   - Use the first matched word's startMs as the line's start time.
   - Compute beat = (startMs / 1000) * bpm / 60, rounded to the nearest 0.25.
   - Return a confidence score: 1.0 = exact token match; ~0.7 = minor phonetic error (e.g. "off" heard as "ball"); ~0.4 = many errors but pattern recognizable; <0.3 = speculative.
   - If a line cannot be confidently located in the transcription, put it in "unmatched" with a brief reason.

Return strict JSON matching the provided schema. No commentary.`;

const cachedBlocks = [
  {
    label: "Whisper transcription (word-level)",
    content: JSON.stringify(wordsJson),
  },
  {
    label: "Raw lyrics text (contains [Section] markers; may include annotations to ignore)",
    content: lyricsPortion,
  },
];

const freshBlock = `BPM: ${bpm}\n\nAlign each published lyric line to the transcription per the rules in the system prompt.`;

console.error(`Calling Haiku to align ${lyricsPortion.split("\n").filter(l => l.trim() && !l.match(/^\s*\[/)).length} lyric lines...`);

const result = await callHaiku({
  systemPrompt: SYSTEM,
  cachedBlocks,
  freshBlock,
  schema: ResultSchema,
  maxTokens: 16000,
});

writeFileSync(resolve(outPath), JSON.stringify(result.parsed, null, 2));

const { alignments, unmatched } = result.parsed;
console.error(`Aligned ${alignments.length} lines (${unmatched.length} unmatched)`);
console.error(formatUsage(result.usage));
console.error(`Wrote ${outPath}`);

if (unmatched.length > 0) {
  console.error(`\nUnmatched lines:`);
  for (const u of unmatched) console.error(`  [${u.section}] ${u.line} — ${u.reason}`);
}

const lowConf = alignments.filter(a => a.confidence < 0.5);
if (lowConf.length > 0) {
  console.error(`\nLow-confidence alignments (<0.5):`);
  for (const a of lowConf) console.error(`  [${a.section}] beat ${a.beat} (conf ${a.confidence.toFixed(2)}) — "${a.line}"`);
}
