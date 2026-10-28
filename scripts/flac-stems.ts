/**
 * Convert every song's WAV stems to FLAC, once. Run from the repo root.
 *
 *   npx tsx scripts/flac-stems.ts               # the folders listed in .clickbait.json
 *   npx tsx scripts/flac-stems.ts songs         # every stems folder under songs/
 *
 * Each `stems/*.wav` is re-encoded sample for sample by `clickbait-audio flac`
 * and the WAV deleted. The song's recipe (package.json) and manifest are
 * rewritten to name the FLACs. Rebuild afterwards (`npm run songs`) so the
 * RPPs point at the new files. Stems can always be split again from source.m4a.
 */

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readClickbaitConfig } from "../src/core/songs-args.js";
import { flacStemRefs } from "../src/build/flac-stems.js";

const BIN = join(process.cwd(), ".claude/skills/clickbait/bin/clickbait-audio");
const args = process.argv.slice(2);
const roots = args.length ? args : readClickbaitConfig(process.cwd()).songs;
if (!roots?.length) {
  console.error("usage: npx tsx scripts/flac-stems.ts [folder...] (default: the songs in .clickbait.json)");
  process.exit(1);
}

const stemDirs = roots.flatMap((r) =>
  execFileSync("find", [r, "-type", "d", "-name", "stems", "-not", "-path", "*/.wireit/*", "-not", "-path", "*/node_modules/*"], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean),
);

let before = 0;
let after = 0;
for (const stems of stemDirs) {
  // A symlinked stem is left alone: it may point outside the song, or nowhere.
  const links = readdirSync(stems).filter((f) => f.endsWith(".wav") && lstatSync(join(stems, f)).isSymbolicLink());
  const wavs = readdirSync(stems).filter((f) => f.endsWith(".wav") && !links.includes(f));
  if (links.length) console.log(`${stems}: left symlinked ${links.join(", ")}`);
  if (!wavs.length) continue;
  for (const name of wavs.map((f) => f.slice(0, -".wav".length))) {
    const wav = join(stems, `${name}.wav`);
    const flac = join(stems, `${name}.flac`);
    execFileSync(BIN, ["flac", wav, flac]);
    before += statSync(wav).size;
    after += statSync(flac).size;
    rmSync(wav);
  }
  // Every FLAC here, so a run that stopped partway still gets its references renamed.
  const names = readdirSync(stems).filter((f) => f.endsWith(".flac")).map((f) => f.slice(0, -".flac".length));
  const song = dirname(stems);
  const refs = [join(song, "package.json"), ...readdirSync(song).filter((f) => f.endsWith(".song.json")).map((f) => join(song, f))];
  const rewritten = refs.filter((file) => {
    if (!existsSync(file)) return false;
    const text = readFileSync(file, "utf8");
    const next = flacStemRefs(text, names);
    if (next !== text) writeFileSync(file, next);
    return next !== text;
  });
  console.log(`${song}: ${wavs.length} stems${rewritten.length ? `, rewrote ${rewritten.map((f) => f.slice(song.length + 1)).join(", ")}` : ""}`);
}
const gb = (b: number) => (b / 1e9).toFixed(2);
console.log(`${gb(before)} GB of WAV became ${gb(after)} GB of FLAC`);
