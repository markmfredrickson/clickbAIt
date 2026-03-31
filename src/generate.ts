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
import { songSlug } from "./dsongl/index.js";
import { exportSongPayload } from "./teleprompter/export.js";
import type { Song } from "./dsongl/index.js";

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

// Find the clickbait-audio binary (prefer release build)
const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const audioBin = existsSync(resolve(root, "target", "release", "clickbait-audio"))
  ? resolve(root, "target", "release", "clickbait-audio")
  : resolve(root, "target", "debug", "clickbait-audio");
if (!existsSync(audioBin)) {
  console.error(`Build the Rust binary first: cargo build --release`);
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

// Discover what cue WAVs are needed by scanning the song tree
const sections = extractSections(song);
console.log(`\nSections: ${sections.map(s => s.name).join(" → ")}`);

// Collect unique cue names: title + auto-cues from sections + manual cue() events
import { linearize } from "./linearize.js";
const allEvents = linearize(song);
const autoCueNames = sections.filter(s => s.cue).map(s => s.name);
const manualCueNames = allEvents.filter(e => e.type === "cue").map(e => e.value);
const cueNames = [...new Set([song.title, ...autoCueNames, ...manualCueNames])];
console.log(`\nGenerating ${cueNames.length} cue WAVs...`);

for (const name of cueNames) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
  generateWav(name, resolve(cueDir, `${slug}.wav`));
}

// Now build RPP (cue WAVs exist on disk for duration measurement)
console.log(`\nBuilding RPP...`);
const { rpp, cueWavsNeeded } = buildRpp(song, {
  cueDir,
  countDir,
  clickDir,
});

const slug = songSlug(song);
const rppPath = resolve(outDir, `${slug}.rpp`);
writeFileSync(rppPath, rpp);

// Write teleprompter sidecar JSON for One Simple Track
const payload = exportSongPayload(song);
const jsonPath = resolve(outDir, `${slug}.json`);
writeFileSync(jsonPath, JSON.stringify(payload, null, 2));

console.log(`\nWritten: ${rppPath}`);
console.log(`Teleprompter: ${jsonPath}`);
console.log(`Cue WAVs: ${cueDir}/`);
console.log(`\nOpen in REAPER and hit play!`);
console.log(`Teleprompter: npx tsx scripts/teleprompter.ts --songs-dir ${outDir}`);
