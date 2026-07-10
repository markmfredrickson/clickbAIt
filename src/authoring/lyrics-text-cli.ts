/**
 * Extract the flat aligner lyric text from a lookup sidecar (see
 * `lyricsTextFromLookup`). File-to-file, so the lyrics never pass through a
 * model. Feed the output to `clickbait-audio align --text`.
 *
 * Usage:
 *   npx tsx src/authoring/lyrics-text-cli.ts <song.lookup.json> [out.lyrics.txt]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { lyricsTextFromLookup } from "./scaffold.js";

const [lookupPath, outPath] = process.argv.slice(2);
if (!lookupPath) {
  console.error("usage: npx tsx src/authoring/lyrics-text-cli.ts <song.lookup.json> [out.lyrics.txt]");
  process.exit(1);
}

const text = lyricsTextFromLookup(readFileSync(lookupPath, "utf8"));
if (outPath) {
  writeFileSync(outPath, text + "\n");
  console.error(`Wrote ${text.split("\n").length} lyric lines to ${outPath}`);
} else {
  process.stdout.write(text + "\n");
}
