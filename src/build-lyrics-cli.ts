/**
 * Build a LyricsDisplay file from a `.song.json` manifest.
 *
 *   npx tsx src/build-lyrics-cli.ts <manifest.song.json> [out.json]
 *
 * Reads the manifest, its alignment, and its beats (paths in the manifest
 * resolve relative to the manifest's own directory), runs the pure builder, and
 * writes the LyricsDisplay JSON. Defaults the output to
 * `<slug>.lyrics-display.json` beside the manifest.
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname, join } from "path";
import { SongManifestSchema } from "./manifest.js";
import { buildLyricsDisplay } from "./build-lyrics-display.js";
import type { AlignInput } from "./lyrics-timing.js";

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error("usage: npx tsx src/build-lyrics-cli.ts <manifest.song.json> [out.json]");
  process.exit(1);
}

const dir = dirname(resolve(manifestPath));
const manifest = SongManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));

const alignRef = manifest.lyrics.alignment;
if (!alignRef) {
  console.error("manifest has no lyrics.alignment — nothing to time the words from");
  process.exit(1);
}
const align = JSON.parse(readFileSync(join(dir, alignRef.file), "utf8")) as AlignInput;

const beatsRaw = JSON.parse(readFileSync(join(dir, manifest.sources.recording.beats.file), "utf8"));
const beats = (beatsRaw.beats ?? beatsRaw) as { time: number }[];

const display = buildLyricsDisplay(manifest, align, beats);

const out = process.argv[3] ?? join(dir, `${display.slug}.lyrics-display.json`);
writeFileSync(out, JSON.stringify(display, null, 2));
console.error(
  `wrote ${out}: ${display.words.length} words, ${display.display.lines.length} lines, ${display.display.sections.length} sections`,
);
