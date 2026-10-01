/**
 * Beat-keyed audio features for visuals: runs `clickbait-audio features` on
 * every stem the manifest lists, moves each onto the beat grid through the
 * recording curve, and writes `<slug>.beat-features.json` beside the manifest.
 *
 *   npx tsx src/visuals/features-cli.ts <manifest.song.json>
 *
 * Each stem's per-frame features also land beside it as
 * `stems/<stem>.features.json`.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { SongManifestSchema, resolveBeatMap } from "../manifest.js";
import { beatMapCurve } from "../core/beat-map.js";
import { toSlug } from "../core/dsongl/slug.js";
import { framesToGrid, normalizeGrid, type FrameFeatures, type NormalFeatures } from "./beat-grid.js";

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error("usage: npx tsx src/visuals/features-cli.ts <manifest.song.json>");
  process.exit(1);
}
const dir = dirname(resolve(manifestPath));
const root = resolve(dirname(new URL(import.meta.url).pathname), "..", "..");
const audioBin = resolve(root, ".claude/skills/clickbait/bin/clickbait-audio");

const manifest = SongManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
const stems = manifest.sources.stems;
if (!stems) throw new Error(`${manifestPath}: no sources.stems to take features from`);
if (stems.clips) {
  // Clips rearrange the recording, so source seconds no longer map to beats
  // through the recording curve alone (the same open issue lyrics have).
  throw new Error(`${manifestPath}: features don't follow stem clips yet`);
}
const curve = beatMapCurve(resolveBeatMap(manifest.sources.recording.beatMap, dir), manifest.bpm);

const round = (v: number[]) => v.map((x) => Math.round(x * 1000) / 1000);
const out: Record<string, Omit<NormalFeatures, "startBeat" | "stepsPerBeat">> = {};
let grid: { startBeat: number; stepsPerBeat: number } | undefined;

for (const [name, file] of Object.entries(stems.files)) {
  const wav = join(dir, stems.dir, file);
  const json = execFileSync(audioBin, ["features", wav], { maxBuffer: 256 * 1024 * 1024 }).toString();
  writeFileSync(wav.replace(/\.[^.]+$/, ".features.json"), json);
  const n = normalizeGrid(framesToGrid(JSON.parse(json) as FrameFeatures, curve));
  grid ??= { startBeat: n.startBeat, stepsPerBeat: n.stepsPerBeat };
  out[name] = {
    loud: round(n.loud),
    onset: round(n.onset),
    bright: round(n.bright),
    low: round(n.low),
    mid: round(n.mid),
    high: round(n.high),
  };
  console.error(`${name}: ${n.onset.length} steps`);
}

const slug = toSlug([manifest.title, manifest.artist].filter(Boolean).join("-"));
const outPath = join(dir, `${slug}.beat-features.json`);
writeFileSync(outPath, JSON.stringify({ ...grid, stems: out }));
console.error(`wrote ${outPath}`);
