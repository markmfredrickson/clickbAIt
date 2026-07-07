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
import { SongManifestSchema, sectionStarts } from "../manifest.js";
import { beatMapToBeats, expandBeatMap } from "../core/beat-map.js";
import { manifestToSong } from "./manifest-to-song.js";
import { RigSchema } from "../rig.js";
import { buildRpp } from "./rpp.js";
import { buildLyricsDisplay } from "./lyrics-display.js";
import { extractSections } from "./sections.js";
import { linearize } from "./linearize.js";
import { songSlug } from "../core/dsongl/index.js";
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
// The recording's per-beat source times come from the inline beat-map (see
// beatMapToBeats): dense pins reproduce detected beats; gaps interpolate. Shared
// by every stem (they play the same recording) and fed to build-rpp.
const { beats } = beatMapToBeats(manifest.sources.recording.beatMap, manifest.bpm);

const root = resolve(dirname(new URL(import.meta.url).pathname), "..", "..");
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
const song = manifestToSong(manifest, dir);

// Cue/count WAVs — same collection as the .ts path, run on the converted Song.
const sections = extractSections(song);
const events = linearize(song);
const maxBeatsPerBar = Math.max(...sections.map((s) => s.timeSignature[0]), song.timeSignature[0]);
// Every spoken word is a cue: section announcements, the title, manual cues, and
// the count numbers (a count-in is just cues "1","2","3",…). One unique set, so
// each distinct word is synthesized exactly once and reused everywhere.
const cueWords = new Set<string>([
  song.title,
  ...sections.filter((s) => s.cue).map((s) => s.name),
  ...events.filter((e) => e.type === "cue").map((e) => e.value),
  ...Array.from({ length: maxBeatsPerBar }, (_, i) => String(i + 1)),
]);

function speak(text: string, wavPath: string): void {
  if (existsSync(wavPath)) return;
  execSync(`"${audioBin}" speak "${text}" -o "${wavPath}"`, { stdio: "pipe" });
}
for (const word of cueWords) speak(word, join(cueDir, `${slugify(word)}.wav`));

// Absolute section start beats, inferred from section order + length (a
// section starts where the sections before it end). starts[i+1] is section i's
// end beat; starts[sections.length] is the song end.
const starts = sectionStarts(manifest.sections, manifest.timeSignature);

// Per-section stretch-marker stride (song beats). Sections that set smStride
// pin only every Nth beat — for loose/rubato passages (e.g. a triplet solo).
const strideRanges = manifest.sections
  .map((s, idx) => ({ s, idx }))
  .filter(({ s }) => s.smStride !== undefined && s.smStride !== 1)
  .map(({ s, idx }) => ({
    // The first section (the intro) extends its range back through the pre-roll:
    // when the anchor offset pushes the earliest audio beats to negative song
    // beats, they must still fall inside the intro's no-marker range or they
    // leak as spurious pre-roll markers.
    startBeat: idx === 0 ? -1e6 : starts[idx],
    endBeat: starts[idx + 1],
    stride: s.smStride!,
  }));

// Ring-out: stems play this many seconds past the song end (1:1) while the
// click halts at the end — for abrupt/hit endings.
const ringOutSec = (manifest.ringOutBars ?? 0) * manifest.timeSignature[0] * (60 / manifest.bpm);

// RPP (cue WAVs now exist for duration measurement).
// Leading stretch-marker source position (seconds) for the intro's single
// stretch segment — hand-tuned intro timing, captured so regen reproduces it.
const introLeadSource = manifest.sections[0]?.smLeadSource ?? 0;
// Hand-tuned intro stretch markers (captured from REAPER), emitted verbatim.
const introMarkers = manifest.sections[0]?.stretchMarkers?.map((m) => ({ itemPosition: m.item, sourcePosition: m.source }));
const { rpp } = buildRpp(song, { cueDir, countDir: cueDir, clickDir, rig, strideRanges, ringOutSec, introLeadSource, introMarkers, recordingBeats: beats });
const slug = songSlug(song);
writeFileSync(join(outDir, `${slug}.RPP`), rpp);

// LyricsDisplay, when an alignment is referenced.
let lyricsMsg = "(no alignment — skipped LyricsDisplay)";
if (manifest.lyrics.alignment) {
  const align = JSON.parse(readFileSync(join(dir, manifest.lyrics.alignment.file), "utf8")) as AlignInput;
  const display = buildLyricsDisplay(manifest, align);
  writeFileSync(join(outDir, `${slug}.lyrics-display.json`), JSON.stringify(display, null, 2));
  lyricsMsg = `${display.words.length} words, ${display.display.lines.length} lines`;
}

console.error(`wrote ${slug}.RPP + ${slug}.lyrics-display.json (${lyricsMsg}) + cues/ in ${outDir}`);

// Timekeeping QC: check each actual STRETCH SEGMENT (marker to marker) against
// the constant tempo. Non-strided sections = per-beat; strided sections =
// downbeat-to-downbeat (sub-beats aren't markers, so their intentional feel
// isn't flagged). A segment >5% off is likely a detection glitch. Flag-only.
const nominalIbi = 60 / manifest.bpm;
const isMarker = (sb: number): boolean => {
  for (const r of strideRanges) {
    if (sb >= r.startBeat && sb < r.endBeat) return r.stride === 0 ? false : (sb - r.startBeat) % r.stride === 0;
  }
  return true;
};
// Check the beat-map's CONTROL POINTS (the authored pins), not the per-beat
// expansion — so a deliberate gap (a compressed rubato intro) reads as one
// segment rather than flooding a warning per interpolated beat, and a strided
// run is checked downbeat-to-downbeat. Only up to the song end (beats past the
// last section are trimmed from the RPP, so their spacing doesn't matter).
const songEndBeat = starts[manifest.sections.length];
const markerBeats = expandBeatMap(manifest.sources.recording.beatMap)
  .map((p) => ({ sb: Math.round(p.b), time: p.t }))
  .filter((p) => isMarker(p.sb) && p.sb <= songEndBeat);
type QcFlag = { time: number; bar: number; relChange: number };
const qcFlags: QcFlag[] = [];
for (let k = 1; k < markerBeats.length; k++) {
  const gapSec = markerBeats[k].time - markerBeats[k - 1].time;
  const gapBeats = markerBeats[k].sb - markerBeats[k - 1].sb; // 1 dense; larger across a gap/strided run
  if (gapBeats <= 0) continue;
  const rel = gapSec / (gapBeats * nominalIbi) - 1;
  if (Math.abs(rel) > 0.05) {
    qcFlags.push({ time: markerBeats[k - 1].time, bar: Math.floor(markerBeats[k - 1].sb / 4) + 1, relChange: rel });
  }
}
if (qcFlags.length === 0) {
  console.error(`timekeeping QC: clean (0 stretch segments > 5%)`);
} else {
  // Two tiers: >5% is routine looseness (counted); >=10% is a painful, likely-
  // audible glitch — surface EVERY one of those (worst-first), never bury them.
  const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(0)}%`;
  const big = qcFlags
    .filter((f) => Math.abs(f.relChange) >= 0.1)
    .sort((a, b) => Math.abs(b.relChange) - Math.abs(a.relChange));
  const minor = qcFlags.length - big.length;
  console.error(`timekeeping QC: ${qcFlags.length} stretch segment(s) > 5% (${big.length} ≥ 10%${minor ? `, ${minor} minor 5–10%` : ""})`);
  for (const f of big) console.error(`  ⚠ bar ${f.bar} (${f.time.toFixed(1)}s)  ${pct(f.relChange)}`);
  if (minor) console.error(`  (${minor} minor 5–10% segment(s) not shown)`);
}
