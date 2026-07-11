#!/usr/bin/env npx tsx
/**
 * inject-lyrics.ts — Read a .lookup.json sidecar and inject lyric() calls
 * into an existing DSongL song file.
 *
 * Usage:
 *   npx tsx scripts/inject-lyrics.ts songs/<artist>/<song>.ts
 *
 * Looks for <song-slug>.lookup.json next to the .ts file.
 * Matches Genius [Section] headers to span names in the song file.
 * Distributes lyric lines evenly across the section's bars.
 *
 * The song file is modified in place. Lyrics are inserted after
 * any existing chord() calls in each span.
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname, basename } from "path";

const songPath = process.argv[2];
if (!songPath) {
  console.error("Usage: npx tsx scripts/inject-lyrics.ts <song-file.ts>");
  process.exit(1);
}

const songDir = dirname(resolve(songPath));
const songBase = basename(songPath, ".ts");
const lookupPath = resolve(songDir, `${songBase}.lookup.json`);

// Read files
let songSource: string;
try {
  songSource = readFileSync(resolve(songPath), "utf8");
} catch {
  console.error(`Cannot read song file: ${songPath}`);
  process.exit(1);
}

let lookupText: string;
try {
  lookupText = readFileSync(lookupPath, "utf8");
} catch {
  console.error(`Cannot read lookup file: ${lookupPath}`);
  console.error("Run: npx clickbait-lookup ... > " + lookupPath);
  process.exit(1);
}

// Parse Genius sections from lookup text
interface GeniusSection {
  name: string;
  lines: string[];
}

function parseGeniusSections(text: string): GeniusSection[] {
  const sections: GeniusSection[] = [];
  let current: GeniusSection | null = null;

  for (const line of text.split("\n")) {
    const sectionMatch = line.match(/^\s*\[(.+)\]\s*$/);
    if (sectionMatch) {
      if (current && current.lines.length > 0) sections.push(current);
      current = { name: sectionMatch[1], lines: [] };
      continue;
    }
    if (current) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("Genius:") && !trimmed.startsWith("Sections found:")) {
        current.lines.push(trimmed);
      }
    }
  }
  if (current && current.lines.length > 0) sections.push(current);
  return sections;
}

// Parse span definitions from song source to get bar counts
interface SongSpan {
  name: string;
  bars: number;
  insertionPoint: number; // character offset where we can insert lyrics
  indent: string;         // whitespace before existing children
}

function parseSongSpans(source: string): SongSpan[] {
  const spans: SongSpan[] = [];
  // Match: span("Name", bars(N), ...
  const spanRe = /span\("([^"]+)",\s*bars\((\d+)\)/g;
  let match;

  while ((match = spanRe.exec(source)) !== null) {
    const name = match[1];
    const barCount = parseInt(match[2]);

    // Find the closing bracket of this span's children array
    // Look for the `[` after the span( declaration on or near this line
    const afterMatch = source.indexOf("[", match.index + match[0].length);
    if (afterMatch === -1) continue;

    // Find the matching `]`
    let depth = 1;
    let pos = afterMatch + 1;
    let lastContentEnd = afterMatch + 1; // after the opening [

    while (pos < source.length && depth > 0) {
      if (source[pos] === "[") depth++;
      if (source[pos] === "]") {
        depth--;
        if (depth === 0) break;
      }
      pos++;
    }

    if (depth !== 0) continue;

    // The insertion point is just before the closing ]
    // Find the last non-whitespace before ]
    let insertAt = pos;
    // Detect indent from context
    const lineStart = source.lastIndexOf("\n", match.index) + 1;
    const lineContent = source.slice(lineStart, match.index);
    const baseIndent = lineContent.match(/^(\s*)/)?.[1] ?? "    ";
    const childIndent = baseIndent + "  ";

    spans.push({
      name,
      bars: barCount,
      insertionPoint: insertAt,
      indent: childIndent,
    });
  }

  return spans;
}

// Match Genius sections to song spans
function matchSection(geniusName: string, spanName: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const gn = normalize(geniusName);
  const sn = normalize(spanName);

  // Exact match
  if (gn === sn) return true;

  // Genius "Chorus" matches "Chorus 1", "Chorus 2", etc.
  if (sn.startsWith(gn)) return true;

  // Genius "Verse 2" matches "Verse 2"
  if (gn === sn) return true;

  return false;
}

// Generate lyric() calls for a section
function generateLyrics(lines: string[], barCount: number, indent: string): string {
  const beatsPerBar = 4; // 4/4 time
  const totalBeats = barCount * beatsPerBar;

  // Distribute lines evenly across the section
  const beatsPerLine = lines.length > 1
    ? Math.floor(totalBeats / lines.length)
    : totalBeats;

  return lines.map((line, i) => {
    const beat = i * beatsPerLine;
    // Escape quotes in lyrics
    const escaped = line.replace(/"/g, '\\"');
    return `${indent}lyric("${escaped}", ${beat}, "Lead Vocal"),`;
  }).join("\n");
}

// Main
const geniusSections = parseGeniusSections(lookupText);
if (geniusSections.length === 0) {
  console.error("No Genius sections found in lookup file.");
  process.exit(1);
}

console.log(`Found ${geniusSections.length} Genius sections:`);
for (const s of geniusSections) {
  console.log(`  [${s.name}] — ${s.lines.length} lines`);
}

const songSpans = parseSongSpans(songSource);
console.log(`\nFound ${songSpans.length} spans in song file:`);
for (const s of songSpans) {
  console.log(`  "${s.name}" — ${s.bars} bars`);
}

// Track which Genius sections have been used (for numbered repeats)
const geniusUsed = new Map<string, number>(); // geniusName -> times used

// Build insertions (work backwards so offsets don't shift)
interface Insertion {
  offset: number;
  text: string;
}

const insertions: Insertion[] = [];

for (const sp of songSpans) {
  // Find matching Genius section
  let matched: GeniusSection | undefined;

  for (const gs of geniusSections) {
    if (matchSection(gs.name, sp.name)) {
      const usedCount = geniusUsed.get(gs.name) ?? 0;
      // For repeated sections (Chorus 1, Chorus 2), reuse the same Genius "Chorus"
      matched = gs;
      geniusUsed.set(gs.name, usedCount + 1);
      break;
    }
  }

  if (!matched) continue;

  // Check if span already has lyric() calls
  const spanRegion = songSource.slice(
    songSource.lastIndexOf("span(", sp.insertionPoint),
    sp.insertionPoint
  );
  if (spanRegion.includes("lyric(")) {
    console.log(`  Skipping "${sp.name}" — already has lyrics`);
    continue;
  }

  const lyrics = generateLyrics(matched.lines, sp.bars, sp.indent);
  console.log(`  Injecting ${matched.lines.length} lines into "${sp.name}" from [${matched.name}]`);
  insertions.push({ offset: sp.insertionPoint, text: "\n" + lyrics + "\n" + sp.indent });
}

if (insertions.length === 0) {
  console.log("\nNo lyrics to inject.");
  process.exit(0);
}

// Apply insertions back-to-front
insertions.sort((a, b) => b.offset - a.offset);
let result = songSource;
for (const ins of insertions) {
  result = result.slice(0, ins.offset) + ins.text + result.slice(ins.offset);
}

writeFileSync(resolve(songPath), result, "utf8");
console.log(`\nWrote ${insertions.length} sections to ${songPath}`);
