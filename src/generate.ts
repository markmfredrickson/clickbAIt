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
const assetsDir = resolve(dirname(new URL(import.meta.url).pathname), "..", "assets");
const countDir = resolve(assetsDir, "counts");
const clickDir = resolve(assetsDir, "clicks");

// Load the song module
const songModule = await import(resolve(songPath));
const song: Song = songModule.default;

console.log(`Song: ${song.title} (${song.bpm} BPM, ${song.timeSignature.join("/")}${song.key ? `, ${song.key}` : ""})`);

// Ensure output dirs exist
mkdirSync(cueDir, { recursive: true });

// Find the clickbait-audio binary
const audioBin = resolve(dirname(new URL(import.meta.url).pathname), "..", "target", "debug", "clickbait-audio");
if (!existsSync(audioBin)) {
  console.error(`Build the Rust binary first: cargo build`);
  process.exit(1);
}

function generateWav(text: string, wavPath: string): void {
  if (existsSync(wavPath)) {
    console.log(`  "${text}" → ${wavPath.split("/").pop()} (cached)`);
    return;
  }
  console.log(`  "${text}" → ${wavPath.split("/").pop()}`);
  execSync(`${audioBin} speak "${text}" -o "${wavPath}"`, { stdio: "pipe" });
}

// Announce WAVs: title, then key
console.log(`\nGenerating announce WAVs...`);
generateWav(song.title, resolve(cueDir, "announce-title.wav"));
if (song.key) {
  generateWav(`in ${song.key}`, resolve(cueDir, "announce-key.wav"));
}

// Extract sections and generate cue WAVs
const sections = extractSections(song);
const uniqueNames = [...new Set(sections.map(s => s.name))];

console.log(`\nSections: ${sections.map(s => s.name).join(" → ")}`);
console.log(`\nGenerating ${uniqueNames.length} cue WAVs...`);

for (const name of uniqueNames) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
  generateWav(name, resolve(cueDir, `${slug}.wav`));
}

// Build RPP
console.log(`\nBuilding RPP...`);
const { rpp } = buildRpp(song, {
  cueDir,
  countDir,
  clickDir,
});

const rppPath = resolve(outDir, `${song.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.rpp`);
writeFileSync(rppPath, rpp);
console.log(`\nWritten: ${rppPath}`);
console.log(`Cue WAVs: ${cueDir}/`);
console.log(`\nOpen in REAPER and hit play!`);
