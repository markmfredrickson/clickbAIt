/**
 * Unify the two beat passes into one grid (see `unify-beats.ts`).
 *
 * Usage:
 *   npm run song:beats-unify -- <song folder or .song.json> [out.beats.json]
 *   npm run song:beats-unify -- <full-mix.beats.json> <drums.beats.json> [out.beats.json]
 *
 * Given a song, it reads the folder's one `*.fullmix.beats.json` and one
 * `*.drums.beats.json` (an error if there are none or several of either).
 *
 * Reads two `beats` sidecars (`{ bpm?, beats: [{time, strength}] }`), merges
 * them, and writes the unified grid. Default output is stdout. Carries the
 * full-mix pass's `bpm` (the tempo source) onto the result.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { unifyBeats, type DetectedBeat } from "../core/unify-beats.js";

interface BeatsFile {
  bpm?: number;
  beats: DetectedBeat[];
}

const usage =
  "usage: npm run song:beats-unify -- <song folder or .song.json> [out.beats.json]\n" +
  "       npm run song:beats-unify -- <full-mix.beats.json> <drums.beats.json> [out.beats.json]";
const args = process.argv.slice(2);
const isSong = (a: string | undefined) => !!a && existsSync(a) && (statSync(a).isDirectory() || a.endsWith(".song.json"));

/** The folder's one file ending in `suffix`. */
function onlyOne(dir: string, suffix: string): string {
  const found = readdirSync(dir).filter((f) => f.endsWith(suffix));
  if (found.length !== 1) {
    console.error(`${found.length ? `${found.length} files` : "no file"} ending ${suffix} in ${dir}${found.length ? ` (${found.join(", ")}): pass the two files instead` : ""}`);
    process.exit(1);
  }
  return join(dir, found[0]);
}

let fullPath: string, drumPath: string, outPath: string | undefined;
if (isSong(args[0])) {
  // Beats are unified before the song has a manifest, so a bare folder will do.
  const dir = statSync(args[0]).isDirectory() ? resolve(args[0]) : dirname(resolve(args[0]));
  [fullPath, drumPath, outPath] = [onlyOne(dir, ".fullmix.beats.json"), onlyOne(dir, ".drums.beats.json"), args[1]];
} else if (args[0] && args[1]) {
  [fullPath, drumPath, outPath] = args;
} else {
  console.error(usage);
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
