/**
 * beats:smooth — write a smoothed beat-map sidecar and point the manifest at it.
 *
 *   npx tsx src/authoring/smooth-beats-cli.ts <manifest.song.json>
 *   CLICKBAIT_MAX_KINK=0.03 npx tsx ... <manifest>   # tighter lock to the click
 *
 * Reads the manifest's beat-map (inline or an existing sidecar), removes stretch
 * warble by nudging downbeat vertices toward constant tempo (keeping their
 * detected times), and writes `<source>.beatmap.json`. If the manifest still has
 * an inline map, it's replaced with a ref to the sidecar — migrating the song to
 * the external form. Idempotent: re-running just refreshes the sidecar.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { SongManifestSchema, resolveBeatMap } from "../manifest.js";
import { smoothBeatMap } from "../core/beat-smooth.js";

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error("usage: smooth-beats-cli <manifest.song.json>");
  process.exit(1);
}
const maxKink = Number(process.env.CLICKBAIT_MAX_KINK ?? "0.04");
const dir = dirname(resolve(manifestPath));

const raw = JSON.parse(readFileSync(manifestPath, "utf8"));
const m = SongManifestSchema.parse(raw);
const beatMap = resolveBeatMap(m.sources.recording.beatMap, dir);

const { beatMap: smoothed, maxKinkBefore, maxKinkAfter } = smoothBeatMap(
  beatMap,
  m.bpm,
  m.timeSignature[0],
  maxKink,
);

// Sidecar sits next to the recording, named after it (like <source>.beats.json).
const sidecar = `${m.sources.recording.file}.beatmap.json`;
writeFileSync(join(dir, sidecar), JSON.stringify(smoothed) + "\n");

// Migrate the manifest to a ref (no-op if it already points at the sidecar).
const wasInline = Array.isArray(raw.sources.recording.beatMap);
raw.sources.recording.beatMap = { file: sidecar, "produced-by": "clickbait beats:smooth" };
writeFileSync(manifestPath, JSON.stringify(raw, null, 2) + "\n");

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
console.log(
  `${m.artist ?? ""} — ${m.title}: worst kink ${pct(maxKinkBefore)} -> ${pct(maxKinkAfter)} ` +
    `(maxKink ${pct(maxKink)}); wrote ${sidecar}${wasInline ? "; manifest beatMap -> ref" : ""}`,
);
