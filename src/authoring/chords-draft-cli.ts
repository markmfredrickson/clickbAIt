/**
 * Draft a song's chord file (`<slug>.chords.lab`) from a chord sheet: chord
 * names over the lyrics, with `[Section]` headers (see charts/chord-sheet.ts).
 * A standalone one-shot, never a build step: the `.lab` it writes is the
 * authored chord file from then on, nudged against the recording in Sonic
 * Visualiser, Audacity or a text editor. It refuses to replace an existing
 * file.
 *
 * Usage:
 *   npx tsx src/authoring/chords-draft-cli.ts <song.song.json> <sheet.txt> [--out f]
 *
 * Set CLICKBAIT_SCAFFOLD_FORCE=1 to replace an existing draft on purpose.
 */

import { readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { SongManifestSchema, resolveBeatMap } from "../manifest.js";
import { beatMapCurve, beatMapToBeats } from "../core/beat-map.js";
import { buildLyricsDisplay } from "../build/lyrics-display.js";
import type { AlignInput } from "../build/lyrics-timing.js";
import { songSections } from "../charts/bar-map.js";
import { draftLab, writeNewFile } from "../charts/chord-draft.js";

const args = process.argv.slice(2);
const outFlag = args.indexOf("--out");
const out = outFlag >= 0 ? args.splice(outFlag, 2)[1] : undefined;
const [manifestPath, sheetPath] = args;
if (!manifestPath || !sheetPath) {
  console.error("usage: npx tsx src/authoring/chords-draft-cli.ts <song.song.json> <sheet.txt> [--out f]");
  process.exit(1);
}

const dir = dirname(resolve(manifestPath));
const manifest = SongManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
manifest.sources.recording.beatMap = resolveBeatMap(manifest.sources.recording.beatMap, dir);
if (!manifest.lyrics.alignment) {
  console.error("the manifest has no lyrics.alignment; the sheet's chords are placed on the aligned words");
  process.exit(1);
}

// Word beats don't depend on the render offset, so no build is needed first.
const align = JSON.parse(readFileSync(join(dir, manifest.lyrics.alignment.file), "utf8")) as AlignInput;
const display = buildLyricsDisplay(manifest, align);
const { offset } = beatMapToBeats(manifest.sources.recording.beatMap, manifest.bpm);
const timing = {
  curve: beatMapCurve(manifest.sources.recording.beatMap, manifest.bpm),
  clips: manifest.sources.stems?.clips,
  offset,
  bpm: manifest.bpm,
};

const { text, errors } = draftLab(
  readFileSync(sheetPath, "utf8"),
  { sections: songSections(manifest.sections, manifest.timeSignature), words: display.words },
  timing,
  { comment: `drafted from ${basename(sheetPath)}; nudge freely, drafting again won't replace this file` },
);
if (!text) {
  console.error(`can't draft chords from ${sheetPath}:\n  ${errors.join("\n  ")}`);
  process.exit(1);
}

const outPath = resolve(out ?? manifestPath.replace(/\.song\.json$/, "") + ".chords.lab");
try {
  writeNewFile(outPath, text, { force: process.env.CLICKBAIT_SCAFFOLD_FORCE === "1" });
} catch (err) {
  console.error(`${(err as Error).message} (CLICKBAIT_SCAFFOLD_FORCE=1 replaces it)`);
  process.exit(1);
}
const file = relative(dir, outPath);
const key = manifest.transpose !== undefined ? `, "key": "played"` : "";
console.log(`wrote ${outPath} (${text.split("\n").filter((l) => l && !l.startsWith("#")).length} chords)`);
console.log(`add to the manifest: "chords": { "file": "${file}"${key} }`);
