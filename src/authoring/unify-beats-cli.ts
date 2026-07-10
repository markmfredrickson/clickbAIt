/**
 * Unify the two beat passes into one grid (see `unify-beats.ts`).
 *
 * Usage:
 *   npx tsx src/authoring/unify-beats-cli.ts <full-mix.beats.json> <drums.beats.json> [out.beats.json]
 *
 * Reads two `beats` sidecars (`{ bpm?, beats: [{time, strength}] }`), merges
 * them, and writes the unified grid. Default output is stdout. Carries the
 * full-mix pass's `bpm` (the tempo source) onto the result.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { unifyBeats, type DetectedBeat } from "../core/unify-beats.js";

interface BeatsFile {
  bpm?: number;
  beats: DetectedBeat[];
}

const [fullPath, drumPath, outPath] = process.argv.slice(2);
if (!fullPath || !drumPath) {
  console.error(
    "usage: npx tsx src/authoring/unify-beats-cli.ts <full-mix.beats.json> <drums.beats.json> [out.beats.json]",
  );
  process.exit(1);
}

const full = JSON.parse(readFileSync(fullPath, "utf8")) as BeatsFile;
const drum = JSON.parse(readFileSync(drumPath, "utf8")) as BeatsFile;

const beats = unifyBeats(full.beats ?? [], drum.beats ?? []);
const result = JSON.stringify({ bpm: full.bpm, beats }, null, 2);

if (outPath) {
  writeFileSync(outPath, result + "\n");
  console.error(`Wrote ${beats.length} unified beats to ${outPath}`);
} else {
  process.stdout.write(result + "\n");
}
