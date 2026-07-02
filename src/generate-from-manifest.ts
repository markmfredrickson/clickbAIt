/**
 * Build a song end-to-end from its inert `.song.json` manifest:
 *   RPP + cue WAVs (via manifestToSong → build-rpp) and the LyricsDisplay
 *   (via build-lyrics). One command, one source.
 *
 *   npx tsx src/generate-from-manifest.ts <manifest.song.json> [out-dir]
 *
 * Reuses the existing engine unchanged — this just wires manifest → Song →
 * build-rpp and manifest + align → build-lyrics. Default output is next to the
 * manifest.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { SongManifestSchema } from "./manifest.js";
import { manifestToSong } from "./manifest-to-song.js";
import { RigSchema } from "./rig.js";
import { buildRpp } from "./build-rpp.js";
import { buildLyricsDisplay } from "./build-lyrics-display.js";
import { extractSections } from "./sections.js";
import { linearize } from "./linearize.js";
import { songSlug } from "./dsongl/index.js";
import type { AlignInput } from "./lyrics-timing.js";

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error("usage: npx tsx src/generate-from-manifest.ts <manifest.song.json> [out-dir]");
  process.exit(1);
}
const dir = dirname(resolve(manifestPath));
const outDir = process.argv[3] ? resolve(process.argv[3]) : dir;

const manifest = SongManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
const beats = JSON.parse(readFileSync(join(dir, manifest.sources.recording.beats.file), "utf8")).beats;

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const audioBin = existsSync(resolve(root, "target/release/clickbait-audio"))
  ? resolve(root, "target/release/clickbait-audio")
  : resolve(root, "target/debug/clickbait-audio");
const clickDir = resolve(root, "assets", "clicks");
const cueDir = join(outDir, "cues");
mkdirSync(cueDir, { recursive: true });

// Rig config (routing + record tracks). Rig-level, not per-song: a repo-root
// default.json applies to every project. Absent → no routing, no record tracks.
const rigPath = process.env.CLICKBAIT_RIG ?? resolve(root, "default.json");
const rig = existsSync(rigPath)
  ? RigSchema.parse(JSON.parse(readFileSync(rigPath, "utf8")))
  : undefined;

// Inert manifest -> internal Song (RPP side).
const song = manifestToSong(manifest, beats, dir);

// Cue/count WAVs — same collection as the .ts path, run on the converted Song.
const sections = extractSections(song);
const events = linearize(song);
const cueNames = [
  ...new Set([song.title, ...sections.filter((s) => s.cue).map((s) => s.name), ...events.filter((e) => e.type === "cue").map((e) => e.value)]),
];
const maxBeatsPerBar = Math.max(...sections.map((s) => s.timeSignature[0]), song.timeSignature[0]);

function speak(text: string, wavPath: string): void {
  if (existsSync(wavPath)) return;
  execSync(`"${audioBin}" speak "${text}" -o "${wavPath}"`, { stdio: "pipe" });
}
for (const name of cueNames) speak(name, join(cueDir, `${slugify(name)}.wav`));
for (let i = 1; i <= maxBeatsPerBar; i++) speak(String(i), join(cueDir, `${i}.wav`));

// RPP (cue WAVs now exist for duration measurement).
const { rpp } = buildRpp(song, { cueDir, countDir: cueDir, clickDir, rig });
const slug = songSlug(song);
writeFileSync(join(outDir, `${slug}.RPP`), rpp);

// LyricsDisplay, when an alignment is referenced.
let lyricsMsg = "(no alignment — skipped LyricsDisplay)";
if (manifest.lyrics.alignment) {
  const align = JSON.parse(readFileSync(join(dir, manifest.lyrics.alignment.file), "utf8")) as AlignInput;
  const display = buildLyricsDisplay(manifest, align, beats);
  writeFileSync(join(outDir, `${slug}.lyrics-display.json`), JSON.stringify(display, null, 2));
  lyricsMsg = `${display.words.length} words, ${display.display.lines.length} lines`;
}

console.error(`wrote ${slug}.RPP + ${slug}.lyrics-display.json (${lyricsMsg}) + cues/ in ${outDir}`);
