/**
 * CLI for rephase-beats: read a beats.json whose grid sits half a beat off
 * (offbeat lock) plus an analysis.json with onsets, write the re-phased
 * beats.json to stdout. Compose at the end of a recipe's beats chain:
 *
 *   ... intro-pins-cli detected.json analysis.json \
 *     | npx tsx .../rephase-beats-cli.ts - source.m4a.analysis.json > source.m4a.beats.json
 *
 * Remember: the manifest's startBeat drops by 0.5 after re-phasing.
 */

import { readFileSync } from "node:fs";
import { rephaseBeats } from "./rephase-beats.js";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const [beatsPath, analysisPath] = args;
const flag = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : undefined;
};
if (!beatsPath || !analysisPath) {
  console.error("usage: npx tsx rephase-beats-cli.ts <beats.json | -> <analysis.json> [--tolerance s] [--min-strength x]");
  process.exit(1);
}

const beatsJson = JSON.parse(readFileSync(beatsPath === "-" ? 0 : beatsPath, "utf8"));
const analysis = JSON.parse(readFileSync(analysisPath, "utf8"));
const beats = rephaseBeats(beatsJson.beats, analysis.onsets, {
  ...(flag("tolerance") !== undefined ? { tolerance: flag("tolerance") } : {}),
  ...(flag("min-strength") !== undefined ? { minStrength: flag("min-strength") } : {}),
});

const snapped = beats.filter((b) => b.strength > 0).length;
process.stdout.write(JSON.stringify({ ...beatsJson, beats }, null, 2) + "\n");
console.error(`re-phased ${beats.length} beats (+half period; ${snapped} snapped to onsets); manifest startBeat -= 0.5`);
