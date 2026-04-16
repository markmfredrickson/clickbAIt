#!/usr/bin/env npx tsx
/**
 * fix-bridge-sm.ts — Remove stretch markers in a gap and insert an anchor.
 *
 * Usage:
 *   npx tsx scripts/fix-bridge-sm.ts <rpp-file> --gap-start <seconds> --anchor-src <seconds> --anchor-bar <bar>
 *
 * Removes all SMs between gap-start and anchor-src (source time),
 * then inserts one SM that maps anchor-src to the grid position of anchor-bar.
 * Operates on all stem tracks. Writes the RPP in place.
 */

import { readFileSync, writeFileSync } from "fs";

const args = process.argv.slice(2);
const rppPath = args[0];
const gapStart = parseFloat(args[args.indexOf("--gap-start") + 1]);
const anchorSrc = parseFloat(args[args.indexOf("--anchor-src") + 1]);
const anchorBar = parseFloat(args[args.indexOf("--anchor-bar") + 1]);

if (!rppPath || isNaN(gapStart) || isNaN(anchorSrc) || isNaN(anchorBar)) {
  console.error("Usage: npx tsx scripts/fix-bridge-sm.ts <rpp> --gap-start <s> --anchor-src <s> --anchor-bar <bar>");
  process.exit(1);
}

// Read the RPP and parse BPM from TEMPO line
const rpp = readFileSync(rppPath, "utf8");
const tempoMatch = rpp.match(/TEMPO (\d+\.?\d*)/);
const bpm = tempoMatch ? parseFloat(tempoMatch[1]) : 107;
const beatLen = 60 / bpm;

// The audio offset (beats) — read from the first ITEM POSITION in a stem track
// Stem tracks have POSITION > 0 if offset is set
const posMatch = rpp.match(/NAME Vocals[\s\S]*?POSITION (\d+\.?\d*)/);
const itemTimelineStart = posMatch ? parseFloat(posMatch[1]) : 0;

console.log(`BPM: ${bpm}, beat length: ${beatLen.toFixed(4)}s`);
console.log(`Item starts at: ${itemTimelineStart.toFixed(2)}s on timeline`);
console.log(`Gap start (source): ${gapStart}s`);
console.log(`Anchor source: ${anchorSrc}s → bar ${anchorBar}`);

// Bar to timeline position (bars are 1-indexed in REAPER)
const anchorBeat = (anchorBar - 1) * 4;
const anchorTimeline = anchorBeat * beatLen;
// Item position = timeline position - item start
const anchorItemPos = anchorTimeline - itemTimelineStart;

console.log(`Anchor grid: beat ${anchorBeat}, timeline ${anchorTimeline.toFixed(2)}s, item pos ${anchorItemPos.toFixed(2)}s`);

// Process each SM line independently
const lines = rpp.split("\n");
let smLinesFixed = 0;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (!line.trim().startsWith("SM ")) continue;

  // Parse pairs from this line
  const pairStrs = line.trim().slice(3).split(/\s*\+\s*/);
  const pairs: { item: number; src: number }[] = [];
  for (const p of pairStrs) {
    const parts = p.trim().split(/\s+/);
    if (parts.length >= 2) {
      pairs.push({ item: parseFloat(parts[0]), src: parseFloat(parts[1]) });
    }
  }

  // Filter: keep pairs outside the gap, add anchor
  const before = pairs.filter(p => p.src < gapStart);
  const after = pairs.filter(p => p.src >= anchorSrc);

  const removed = pairs.length - before.length - after.length;
  if (removed === 0) continue; // This SM line doesn't overlap the gap

  // Shift all "after" pairs so the anchor lands at the right item position
  if (after.length > 0) {
    const currentAnchorItem = after[0].item;
    const shift = currentAnchorItem - anchorItemPos;
    console.log(`  Line ${i}: removing ${removed} SMs, shifting ${after.length} after by ${-shift.toFixed(2)}s (${(-shift/beatLen).toFixed(1)} beats)`);
    for (const p of after) {
      p.item -= shift;
    }
  }

  // Rebuild the line
  const allPairs = [...before, ...after];
  if (allPairs.length === 0) {
    lines[i] = ""; // Remove empty SM line
  } else {
    const formatted = allPairs.map(p =>
      `${p.item.toFixed(9)} ${p.src.toFixed(9)}`
    ).join(" + ");
    lines[i] = `      SM ${formatted}`;
  }
  smLinesFixed++;
}

// Handle multi-line SMs: consecutive SM lines belong to the same track
// The above handles each line independently which should work since
// the gap spans will typically be on one or two SM lines

writeFileSync(rppPath, lines.filter(l => l !== "").join("\n"));
console.log(`\nFixed ${smLinesFixed} SM lines in ${rppPath}`);
