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

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname, join, relative, basename } from "node:path";
import { SongManifestSchema, sectionStarts, resolveBeatMap } from "../manifest.js";
import { beatMapToBeats, expandBeatMap } from "../core/beat-map.js";
import { manifestToSong } from "./manifest-to-song.js";
import { chordWav } from "./tone.js";
import { RigSchema } from "../rig.js";
import { buildRpp } from "./rpp.js";
import { buildLyricsDisplay } from "./lyrics-display.js";
import { extractSections } from "./sections.js";
import { cueOnset } from "./cue-onset.js";
import { pCenterSeconds, type AlignChar } from "./pcenter.js";
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
// Resolve the beat-map: if it points at an external <source>.beatmap.json, load
// it and normalize to the inline form here, so every downstream consumer
// (beatMapToBeats, expandBeatMap, buildLyricsDisplay) sees a plain BeatMap.
manifest.sources.recording.beatMap = resolveBeatMap(manifest.sources.recording.beatMap, dir);
// The recording's per-beat source times come from the inline beat-map (see
// beatMapToBeats): dense pins reproduce detected beats; gaps interpolate. Shared
// by every stem (they play the same recording) and fed to build-rpp.
const { beats, offset: beatsOffset } = beatMapToBeats(manifest.sources.recording.beatMap, manifest.bpm);

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
  ...events.filter((e) => e.type === "cue" && !e.tone).map((e) => e.value),
  ...Array.from({ length: maxBeatsPerBar }, (_, i) => String(i + 1)),
]);

function speak(text: string, wavPath: string): void {
  if (existsSync(wavPath)) return;
  execSync(`"${audioBin}" speak "${text}" -o "${wavPath}"`, { stdio: "pipe" });
}
for (const word of cueWords) speak(word, join(cueDir, `${slugify(word)}.wav`));

// Pitch cues (cold-open prep tones): synthesize a held chord instead of speaking.
// Filename matches build-rpp's cue-file slug so it's picked up by placement.
const cueFileSlug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
for (const e of events) {
  if (e.type !== "cue" || !e.tone) continue;
  const beatsPerBar = manifest.timeSignature[0];
  const seconds = (e.toneBars ?? 1) * beatsPerBar * (60 / manifest.bpm);
  writeFileSync(join(cueDir, `${cueFileSlug(e.value)}.wav`), chordWav(e.tone, seconds));
}

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
let ringOutSec = (manifest.ringOutBars ?? 0) * manifest.timeSignature[0] * (60 / manifest.bpm);

// Click drop: the click halts at the first section that turns it off (`click:
// false`). Only the TRAILING case is supported (off through the end); warn if a
// later section turns it back on (mid-song click-off needs the click item split).
const noClickIdx = manifest.sections.findIndex((s) => s.click === false);
if (noClickIdx >= 0 && !manifest.sections.slice(noClickIdx).every((s) => s.click === false)) {
  console.error("warning: mid-song click-off not supported — click stays off from the first `click:false` section to the end");
}
const clickDropBeat = noClickIdx >= 0 ? starts[noClickIdx] : undefined;

// A trailing `smStride: 0` section plays 1:1 (unwarped), so its natural length
// (a slowing outro) exceeds its nominal bars. Extend the ring-out to the source
// end so the ending isn't clipped at the constant-grid boundary. The last real
// stretch marker sits at the section's downbeat (source time s0); playing 1:1
// from there covers (sourceEnd - s0), plus a small tail for the final note.
const lastSec = manifest.sections.at(-1);
if (lastSec?.smStride === 0) {
  const outroStartBeat = starts[manifest.sections.length - 1];
  const s0 = beats[Math.round(outroStartBeat - beatsOffset)]?.time;
  const sourceEnd = beats.at(-1)?.time;
  if (s0 !== undefined && sourceEnd !== undefined && sourceEnd > s0) {
    ringOutSec = Math.max(ringOutSec, sourceEnd - s0 + 2); // +2s tail for the final ring
  }
}

// RPP (cue WAVs now exist for duration measurement).
// Leading stretch-marker source position (seconds) for the intro's single
// stretch segment — hand-tuned intro timing, captured so regen reproduces it.
const introLeadSource = manifest.sections[0]?.smLeadSource ?? 0;
// Hand-tuned intro stretch markers (captured from REAPER), emitted verbatim.
const introMarkers = manifest.sections[0]?.stretchMarkers?.map((m) => ({ itemPosition: m.item, sourcePosition: m.source }));

// Perceptual-center offset per cue WAV (seconds into the file) to land on its
// beat. Primary: FORCED ALIGNMENT (wav2vec2 `align`) → character times → P-center
// (pcenter.ts): a count number's/manual cue's FIRST-syllable P-center, a section
// name's LAST-syllable (pickup resolving on the "1"). Energy-envelope (cue-onset.ts)
// is the fallback if alignment fails. Cue WAVs are deterministic, so this is stable.
const NUM_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const alignChars = (wav: string, text: string): AlignChar[] => {
  const j = JSON.parse(execSync(`"${audioBin}" align "${wav}" --text ${JSON.stringify(text)}`, { stdio: ["pipe", "pipe", "ignore"] }).toString());
  return (j.words ?? []).flatMap((w: { chars?: AlignChar[] }) => w.chars ?? []);
};
const pcenterOr = (wav: string, text: string, mode: "first" | "last"): number | undefined => {
  try { return pCenterSeconds(alignChars(wav, text), mode); }
  catch { try { return cueOnset(wav, mode); } catch { return undefined; } }
};
const cueOnsets: Record<string, number> = {};
for (const s of sections) {
  if (!s.cue) continue;
  const slug = slugify(s.name);
  const v = pcenterOr(join(cueDir, `${slug}.wav`), s.name, "last");
  if (v !== undefined) cueOnsets[slug] = v;
}
for (let n = 1; n <= maxBeatsPerBar; n++) {
  const v = pcenterOr(join(cueDir, `${n}.wav`), NUM_WORDS[n - 1] ?? String(n), "first");
  if (v !== undefined) cueOnsets[String(n)] = v;
}
for (const e of events) {
  if (e.type !== "cue" || e.tone) continue; // pitch cues aren't onset-anchored — placed at the authored beat
  const sl = slugify(e.value);
  if (sl in cueOnsets) continue; // numbers already measured
  const v = pcenterOr(join(cueDir, `${sl}.wav`), e.value, "first");
  if (v !== undefined) cueOnsets[sl] = v;
}

const { rpp, paddingBeats } = buildRpp(song, { cueDir, countDir: cueDir, clickDir, rig, strideRanges, ringOutSec, clickDropBeat, introLeadSource, introMarkers, recordingBeats: beats, cueOnsets });
const slug = songSlug(song);
// Emit RELATIVE media paths so the project folder is self-contained and portable
// (REAPER resolves paths against the .RPP's own folder). In-folder media —
// cues/, stems/, source — drop the outDir prefix; the shared click samples
// (repo assets/) become a path relative to the song folder (…/assets/clicks).
const rppRel = rpp
  .split(outDir + "/").join("")
  .split(clickDir + "/").join(relative(outDir, clickDir) + "/");
writeFileSync(join(outDir, `${slug}.RPP`), rppRel);

// LyricsDisplay, when an alignment is referenced.
let lyricsMsg = "(no alignment — skipped LyricsDisplay)";
if (manifest.lyrics.alignment) {
  const align = JSON.parse(readFileSync(join(dir, manifest.lyrics.alignment.file), "utf8")) as AlignInput;
  const display = buildLyricsDisplay(manifest, align, { renderOffsetBeats: paddingBeats });
  writeFileSync(join(outDir, `${slug}.lyrics-display.json`), JSON.stringify(display, null, 2));
  lyricsMsg = `${display.words.length} words, ${display.display.lines.length} lines`;
}

// Emit the per-song build unit: a package.json with wireit `build`/`bundle`
// steps so the song is an incremental target — `npm run build` regenerates it
// only when its manifest / align / beats / rig change; `npm run bundle` renders
// + bundles on demand. Skip flat multi-manifest dirs (a flat folder holding several manifests): one
// package.json can't describe several songs. Tool code changes aren't tracked —
// after those, force a full rebuild (see the skill).
if (readdirSync(dir).filter((f) => f.endsWith(".song.json")).length === 1) {
  const rel = relative(outDir, root) || ".";
  const manifestBase = basename(manifestPath);
  const unit = {
    name: `clickbait-song-${slug}`,
    private: true,
    scripts: { build: "wireit", bundle: "wireit" },
    wireit: {
      build: {
        command: `npx tsx ${rel}/src/build/generate.ts ${manifestBase}`,
        files: [manifestBase, "*.beats.json", "*.beatmap.json", "stems/*.align.json", `${rel}/default.json`],
        output: ["*.RPP", "*.lyrics-display.json", "cues/**"],
      },
      bundle: {
        command: `npx tsx ${rel}/scripts/render-bundle.ts .`,
        files: [manifestBase, "*.beats.json", "*.beatmap.json", "stems/**", "source.*", `${rel}/default.json`],
        output: ["*.opus", `${rel}/bundles/${slug}/**`, `${rel}/bundles/${slug}.zip`],
      },
    },
  };
  writeFileSync(join(outDir, "package.json"), JSON.stringify(unit, null, 2) + "\n");
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
