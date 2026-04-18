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

// Trim lookup to just the Genius portion — strip the Deezer/MusicBrainz header
const geniusStart = lookupText.search(/\n\s*\[/);
const lyricsPortion = geniusStart >= 0 ? lookupText.slice(geniusStart).trim() : lookupText;

const SYSTEM = `You are a structural alignment tool.

Task: given a published lyrics text (with [Section] markers) and a Whisper transcription of an audio recording of the same song (word-level, with timestamps), determine which transcribed words correspond to each published lyric line. This is a text-to-text alignment problem — the transcription has errors, so fuzzy/phonetic matching is expected. The published lyrics are the canonical text.

For each published lyric line:
  1. Find the best-matching consecutive sequence of Whisper words.
  2. Use the first matched word's startMs as the line's start time.
  3. Return startMs, computed beat, and a confidence score.

Rules:
  - Preserve the exact section names from the [brackets] in the published text.
  - Preserve each published line verbatim — do not paraphrase, merge, or reorder.
  - If a line cannot be confidently located in the transcription, put it in "unmatched" with a brief reason (e.g. "no matching words in transcription" or "ambiguous — multiple candidate positions").
  - confidence: 1.0 = exact token match; ~0.7 = minor phonetic error (e.g. "off" heard as "ball"); ~0.4 = many errors but pattern recognizable; <0.3 = speculative.
  - beat = (startMs / 1000) * bpm / 60, rounded to the nearest 0.25.

Return strict JSON matching the provided schema. Do not include commentary.`;

const cachedBlocks = [
  {
    label: "Whisper transcription (word-level)",
    content: JSON.stringify(wordsJson),
  },
  {
    label: "Published lyrics with section markers",
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
