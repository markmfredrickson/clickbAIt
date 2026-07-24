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
import { resolve, dirname, join, relative } from "node:path";
import { SongManifestSchema, sectionStarts, resolveBeatMap } from "../manifest.js";
import { beatMapToBeats, expandBeatMap } from "../core/beat-map.js";
import { manifestToSong } from "./manifest-to-song.js";
import { chordWav } from "./tone.js";
import { RigSchema } from "../rig.js";
import { buildRpp } from "./rpp.js";
import { buildLyricsDisplay } from "./lyrics-display.js";
import { songRecipe } from "./song-recipe.js";
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
// Canonical version = package.json `version` — it ships inside any distribution,
// so it's always readable (a git `describe` would be "unknown" once installed
// without a .git). Release flow: `npm version <bump>` bumps package.json AND tags
// the commit, keeping the tag and the shipped version in sync. In the dev repo we
// append `git describe` as build metadata (+<tag>-<n>-g<sha>[-dirty]) for build
// precision; it's simply absent when distributed.
const clickbaitVersion = (() => {
  let v = "unknown";
  try {
    v = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version ?? "unknown";
  } catch {
    /* no package.json — leave unknown */
  }
  try {
    const g = execSync("git describe --tags --always --dirty", { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    if (g) v = `${v}+${g}`;
  } catch {
    /* no git (e.g. distributed) — package.json version stands alone */
  }
  return v;
})();
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
    // The last section extends its range forward past the song end: a ring-out
    // (smStride:0) whose recording rings longer than its nominal grid bars would
    // otherwise leak the source beats past the section boundary as a spurious
    // end-anchor marker, stretching the whole outro to reach source-end. Symmetric
    // with the intro's -1e6 pre-roll extension.
    endBeat: idx === manifest.sections.length - 1 ? 1e6 : starts[idx + 1],
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

// A trailing `smStride: 0` section (a ring-out) plays 1:1 from the last clicked
// beat. The SECTION LENGTH bounds the ending — the stems play the outro's bars
// then stop at the song end. (An earlier version extended to the source end; that
// overran the outro and, when the item outgrew the source, looped it. If more
// decay is wanted, add outro bars or `ringOutBars`, not a source-end reach.)

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

// Build stamp — which clickbait produced this output. A gitignored sidecar (a
// build OUTPUT, not a manifest field: `build` must never write its own input, or
// it self-invalidates the wireit cache like the old smooth-rewrites-manifest bug).
// No tracked churn; travels with the song folder / bundle for reproducibility.
writeFileSync(
  join(outDir, `${slug}.build.json`),
  JSON.stringify({ clickbait: clickbaitVersion, generatedAt: new Date().toISOString(), node: process.version }, null, 2) + "\n",
);

// LyricsDisplay, when an alignment is referenced.
let lyricsMsg = "(no alignment — skipped LyricsDisplay)";
if (manifest.lyrics.alignment) {
  const align = JSON.parse(readFileSync(join(dir, manifest.lyrics.alignment.file), "utf8")) as AlignInput;
  const display = buildLyricsDisplay(manifest, align, { renderOffsetBeats: paddingBeats });
  writeFileSync(join(outDir, `${slug}.lyrics-display.json`), JSON.stringify(display, null, 2));
  lyricsMsg = `${display.words.length} words, ${display.display.lines.length} lines`;
}

// Scaffold the per-song build unit — a package.json wireit recipe — but ONLY if
// it doesn't already exist. The recipe is AUTHORED (you tune --min-bpm/--max-bpm,
// --start/--until, --max-warble, the stem model), so `generate` must never clobber
// it. It runs the binary steps as tasks: `beats` detects, `smooth` builds the
// beatmap, `build` (this script) assembles the RPP, `bundle` renders. `beats` is
// standalone, not a build dep, so a tuned detection is never re-run by accident;
// run it explicitly (once, or when you change its flags), then `npm run build`.
// Skip flat multi-manifest dirs — one package.json can't describe several songs.
const pkgPath = join(outDir, "package.json");
if (readdirSync(dir).filter((f) => f.endsWith(".song.json")).length === 1 && !existsSync(pkgPath)) {
  const rel = relative(outDir, root) || ".";
  const recFile = manifest.sources.recording.file;
  const minBpm = Math.round(manifest.bpm * 0.9);
  const maxBpm = Math.round(manifest.bpm * 1.1);
  // Forced alignment is a build output: derive the vocal stem from the manifest's
  // alignment.file (`<stem>.align.json` → `<stem>.wav`) and align the authored
  // `<slug>.lyrics.txt` against it. Default is the CHUNKED aligner (chunk on
  // silence → Whisper-match → wav2vec2 per chunk → stitch), which handles repeated
  // choruses far better than the single-shot binary `align`. Only emit the task
  // when the manifest declares an alignment AND the standard inputs exist; a KV
  // multitrack or a missing lyrics text falls back to a tracked align.json (author
  // wires it by hand). Dense-vocal songs may need chunk-param tuning appended here.
  const alignFile = manifest.lyrics?.alignment?.file;
  const alignStem = alignFile?.replace(/\.align\.json$/, ".wav");
  const lyricsTxt = `${slug}.lyrics.txt`;
  const canAlign =
    !!alignFile && !!alignStem && existsSync(join(dir, alignStem)) && existsSync(join(dir, lyricsTxt));
  // Recipe shape lives in song-recipe.ts, shared with `init-song` (which writes
  // it up front). Here it's the legacy fallback: only fires for a song that
  // never went through init and still lacks a package.json.
  const unit = songRecipe({
    slug,
    title: manifest.title,
    artist: manifest.artist,
    key: manifest.key,
    rel,
    minBpm,
    maxBpm,
    recFile,
    canAlign,
    alignStem,
    alignFile,
  });
  writeFileSync(pkgPath, JSON.stringify(unit, null, 2) + "\n");
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

// Phase-ambiguity QC (guiding principle: raise a red flag when the DBN and the raw
// onsets disagree on phase — a human ear settles it). The DBN beat-tracker locks
// phase by onset STRENGTH, so a soft true downbeat next to a louder offbeat can
// flip the grid a half-beat (see you-cant-hurry-love). Compare the grid to the RAW
// onsets (`analyze`): if onset energy a half-beat OFF the grid rivals the on-grid
// energy, the phase is ambiguous — flag it. Can't catch every phase error, but we
// surface the ambiguous ones for confirmation.
try {
  const recPath = join(dir, manifest.sources.recording.file);
  const analysisPath = `${recPath}.analysis.json`;
  const onsets: { time: number; strength: number }[] = existsSync(analysisPath)
    ? (JSON.parse(readFileSync(analysisPath, "utf8")).onsets ?? [])
    : (JSON.parse(execSync(`"${audioBin}" analyze "${recPath}"`, { stdio: ["pipe", "pipe", "ignore"] }).toString()).onsets ?? []);
  const gridTimes = beats.map((b) => b.time).filter((t) => t >= 0);
  if (onsets.length >= 8 && gridTimes.length >= 3) {
    const ibi = (gridTimes[gridTimes.length - 1] - gridTimes[0]) / (gridTimes.length - 1);
    let onE = 0;
    let offE = 0;
    for (const o of onsets) {
      let nearest = Infinity;
      for (const g of gridTimes) {
        const dd = Math.abs(o.time - g);
        if (dd < nearest) nearest = dd;
        else if (g > o.time + nearest) break; // gridTimes ascending → no closer beat ahead
      }
      const frac = nearest / ibi; // 0 = on a beat, ~0.5 = on the half-beat
      if (frac < 0.25) onE += o.strength;
      else if (frac >= 0.35) offE += o.strength;
    }
    // Flag only when off-beat energy RIVALS/exceeds on-beat (~0.85+): that's real
    // downbeat ambiguity (the offbeat is as loud as the beat, so the DBN can flip
    // phase). A strong backbeat with the downbeat still dominant (ratio well under
    // 1) is fine — don't cry wolf on every four-on-the-floor.
    const ratio = onE > 0 ? offE / onE : 0;
    if (ratio > 0.85) {
      console.error(
        `⚠ phase QC: off-beat onset energy is ${Math.round(ratio * 100)}% of on-beat — ` +
          `DOWNBEAT/PHASE AMBIGUOUS, confirm by ear (a soft downbeat beside a loud offbeat can flip the grid a half-beat)`,
      );
    } else {
      console.error(`phase QC: grid sits on the onsets (off/on ${Math.round(ratio * 100)}%)`);
    }
  }
} catch {
  /* analyze unavailable (e.g., a distributed install without the binary) — skip phase QC */
}
