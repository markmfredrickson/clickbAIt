/**
 * End-to-end generator: Song → cue WAVs + RPP file.
 *
 * Usage: npx tsx src/generate.ts <song-file.ts> [output-dir]
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { execSync } from "child_process";
import { resolve, dirname } from "path";
import { buildRpp } from "./build-rpp.js";
import { extractSections } from "./sections.js";
import type { Song } from "./types.js";

const songPath = process.argv[2];
if (!songPath) {
  console.error("Usage: npx tsx src/generate.ts <song-file.ts> [output-dir]");
  process.exit(1);
}

const outDir = process.argv[3] ?? "/tmp/clickbait-output";
const cueDir = resolve(outDir, "cues");
const countDir = resolve(dirname(new URL(import.meta.url).pathname), "..", "assets", "counts");

// Load the song module
const songModule = await import(resolve(songPath));
const song: Song = songModule.default;

console.log(`Song: ${song.title} (${song.bpm} BPM, ${song.timeSignature.join("/")})`);

// Ensure output dirs exist
mkdirSync(cueDir, { recursive: true });

// Find the clickbait-audio binary
const audioBin = resolve(dirname(new URL(import.meta.url).pathname), "..", "target", "debug", "clickbait-audio");
if (!existsSync(audioBin)) {
  console.error(`Build the Rust binary first: cargo build`);
  process.exit(1);
}

// Extract sections and generate cue WAVs
const sections = extractSections(song);
const uniqueNames = [...new Set(sections.map(s => s.name))];

console.log(`\nSections: ${sections.map(s => s.name).join(" → ")}`);
console.log(`\nGenerating ${uniqueNames.length} cue WAVs...`);

for (const name of uniqueNames) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
  const wavPath = resolve(cueDir, `${slug}.wav`);
  if (existsSync(wavPath)) {
    console.log(`  ${name} → ${slug}.wav (cached)`);
    continue;
  }
  console.log(`  ${name} → ${slug}.wav`);
  execSync(`${audioBin} speak "${name}" -o "${wavPath}"`, { stdio: "pipe" });
}

// Build RPP
console.log(`\nBuilding RPP...`);
const { rpp, cueWavsNeeded } = buildRpp(song, {
  cueDir,
  countDir,
  cueDuration: 0.8,
  countDuration: 0.4,
});

const rppPath = resolve(outDir, `${song.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.rpp`);
writeFileSync(rppPath, rpp);
console.log(`\nWritten: ${rppPath}`);
console.log(`Cue WAVs: ${cueDir}/`);
console.log(`\nOpen in REAPER and hit play!`);
