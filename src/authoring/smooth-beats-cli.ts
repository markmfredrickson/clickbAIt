/**
 * beats:smooth — build the smoothed beat-map sidecar from the raw detected beats.
 *
 *   npx tsx src/authoring/smooth-beats-cli.ts <manifest.song.json>
 *   npx tsx ... <manifest> --max-warble 0.03   # tighter lock to the click
 *
 * Reads the RAW detected beats (`<source>.beats.json`), anchors them to the song
 * grid via the manifest's `sources.recording.startBeat` (which detected beat lands
 * on which song beat — the one thing detection can't know), removes stretch warble
 * by nudging downbeat vertices toward constant tempo (keeping their detected
 * times), and writes `<source>.beatmap.json`. The warble is normalized against the
 * DETECTED bpm from beats.json, not the manifest. Pure file→file; idempotent.
 *
 * A trailing `smStride: 0` ring-out section is left RAW (only the click region is
 * smoothed) so a free/slowing ending can't bleed backward into the clicked bars.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { SongManifestSchema, sectionStarts } from "../manifest.js";
import { smoothBeatMap } from "../core/beat-smooth.js";
import { beatsToBeatMap } from "../core/beat-map.js";

const args = process.argv.slice(2);
let maxWarble = 0.04; // max allowed relative slope change between adjacent segments
let manifestPath: string | undefined;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--max-warble") maxWarble = Number(args[++i]);
  else if (a.startsWith("--max-warble=")) maxWarble = Number(a.slice("--max-warble=".length));
  else if (!manifestPath) manifestPath = a;
}
if (!manifestPath) {
  console.error("usage: smooth-beats-cli <manifest.song.json> [--max-warble <frac>]");
  process.exit(1);
}
const dir = dirname(resolve(manifestPath));

const raw = JSON.parse(readFileSync(manifestPath, "utf8"));
const m = SongManifestSchema.parse(raw);

// Raw detected beats live next to the recording as `<source>.beats.json`
// ({ beats: [{ time, strength }], bpm }). Anchor them to the song grid with the
// authored startBeat (which detected beat is which song beat), and normalize the
// warble against the DETECTED bpm — the reference tempo of this very curve.
const beatsFile = `${m.sources.recording.file}.beats.json`;
const beatsJson = JSON.parse(readFileSync(join(dir, beatsFile), "utf8")) as {
  beats: { time: number }[];
  bpm: number;
};
const times = beatsJson.beats.map((b) => b.time);
const detectedBpm = beatsJson.bpm;
const startBeat = m.sources.recording.startBeat ?? 0;
const beatMap = beatsToBeatMap(times, startBeat);

// A trailing `smStride: 0` section is a ring-out that plays 1:1 — its beats are
// free (a slowing or jittery recorded ending). Smoothing across that boundary
// pulls the free tail's reversals BACK into the click grid, warping the last
// clicked bar. So smooth only the click region (up to the ring-out downbeat) and
// leave the tail exactly as detected.
const lastSec = m.sections.at(-1);
const ringOutBeat =
  lastSec?.smStride === 0
    ? sectionStarts(m.sections, m.timeSignature)[m.sections.length - 1]
    : undefined;

let smoothed: typeof beatMap;
let maxKinkBefore: number;
let maxKinkAfter: number;
if (ringOutBeat !== undefined) {
  const k = ringOutBeat - startBeat; // index of the ring-out downbeat
  const head = times.slice(0, k + 1);
  const tail = times.slice(k + 1); // free ring-out — kept raw
  const res = smoothBeatMap([{ startBeat, times: head }], detectedBpm, m.timeSignature[0], maxWarble);
  const smHead = (res.beatMap[0] as { startBeat: number; times: number[] }).times;
  smoothed = [{ startBeat, times: smHead.concat(tail) }];
  maxKinkBefore = res.maxKinkBefore;
  maxKinkAfter = res.maxKinkAfter;
} else {
  const res = smoothBeatMap(beatMap, detectedBpm, m.timeSignature[0], maxWarble);
  smoothed = res.beatMap;
  maxKinkBefore = res.maxKinkBefore;
  maxKinkAfter = res.maxKinkAfter;
}

// Sidecar sits next to the recording, named after it (like <source>.beats.json).
const sidecar = `${m.sources.recording.file}.beatmap.json`;
writeFileSync(join(dir, sidecar), JSON.stringify(smoothed) + "\n");

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
console.log(
  `${m.artist ?? ""} — ${m.title}: worst warble ${pct(maxKinkBefore)} -> ${pct(maxKinkAfter)} ` +
    `(maxWarble ${pct(maxWarble)}); anchor ${startBeat}; wrote ${sidecar}`,
);
