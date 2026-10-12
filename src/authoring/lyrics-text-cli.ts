/**
 * Extract the flat aligner lyric text from a lookup sidecar (see
 * `lyricsTextFromLookup`). File-to-file, so the lyrics never pass through a
 * model. Feed the output to `clickbait-audio align --text`.
 *
 * Usage:
 *   npx tsx src/authoring/lyrics-text-cli.ts <song.lookup.json> [out.lyrics.txt]
 *   npx tsx src/authoring/lyrics-text-cli.ts --manifest <song.song.json> [out.lyrics.txt]
 *
 * With --manifest the text is the manifest's lyric lines (see
 * `lyricsTextFromManifest`), for a multitrack song with no lookup lyrics.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { lyricsTextFromLookup, lyricsTextFromManifest } from "./scaffold.js";

const args = process.argv.slice(2);
const fromManifest = args[0] === "--manifest";
const [inPath, outPath] = fromManifest ? args.slice(1) : args;
if (!inPath) {
  console.error("usage: npx tsx src/authoring/lyrics-text-cli.ts <song.lookup.json> [out.lyrics.txt]");
  console.error("       npx tsx src/authoring/lyrics-text-cli.ts --manifest <song.song.json> [out.lyrics.txt]");
  process.exit(1);
}

const input = readFileSync(inPath, "utf8");
const text = fromManifest ? lyricsTextFromManifest(JSON.parse(input)) : lyricsTextFromLookup(input);
if (outPath) {
  writeFileSync(outPath, text + "\n");
  console.error(`Wrote ${text.split("\n").length} lyric lines to ${outPath}`);
} else {
  process.stdout.write(text + "\n");
}
