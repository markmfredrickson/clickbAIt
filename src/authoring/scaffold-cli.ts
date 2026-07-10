/**
 * Scaffold a draft `<slug>.song.json` from the mechanical inputs (see
 * `scaffold.ts`). This is the deterministic first cut — bar counts, instrumental
 * sections, meter changes, and count-in cues are left for review.
 *
 * Usage:
 *   npx tsx src/authoring/scaffold-cli.ts --title "Song" --source source.m4a \
 *     --beats unified.beats.json [--artist "Artist"] [--key Bb] \
 *     [--lookup song.lookup.json] [--align stems/vocals.align.json] \
 *     [--stems-dir stems/] [--start-beat N] [--out song.song.json]
 *
 * Env overrides (for when the tracker locked onto the wrong pulse):
 *   CLICKBAIT_BPM_FOLD=half|double   fold the detected tempo + grid by 2×
 *   CLICKBAIT_BPM_PHASE=1            with fold=half, keep the odd-indexed beats
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import {
  buildScaffold,
  foldBeats,
  lyricBlockFromLookup,
  type ScaffoldInputs,
} from "./scaffold.js";
import type { DetectedBeat } from "../core/unify-beats.js";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const title = flag("title");
const source = flag("source");
const beatsPath = flag("beats");
if (!title || !source || !beatsPath) {
  console.error(
    "usage: npx tsx src/authoring/scaffold-cli.ts --title <t> --source <file> --beats <unified.beats.json> [--artist a] [--key k] [--lookup f] [--align f] [--stems-dir d] [--start-beat n] [--out f]",
  );
  process.exit(1);
}

// Beats → grid, with optional fold.
const beatsFile = JSON.parse(readFileSync(beatsPath, "utf8")) as {
  bpm?: number;
  beats: DetectedBeat[];
};
const rawBpm = beatsFile.bpm ?? 120;
const rawTimes = (beatsFile.beats ?? []).map((b) => b.time);
const foldMode = process.env.CLICKBAIT_BPM_FOLD as "half" | "double" | undefined;
const phase = process.env.CLICKBAIT_BPM_PHASE === "1" ? 1 : 0;
const { bpm, times } = foldBeats(rawBpm, rawTimes, foldMode, phase);

// Genius lyric block, if a lookup sidecar was given.
const lookupPath = flag("lookup");
const genius = lookupPath ? lyricBlockFromLookup(readFileSync(lookupPath, "utf8")) : undefined;

// Paths in the manifest are stored RELATIVE TO THE MANIFEST (the --out dir), since
// that's how the manifest references its files. Flags themselves are CWD-relative.
const outPath = flag("out");
const rel = (p: string) =>
  outPath ? relative(dirname(resolve(outPath)), resolve(p)) : p;

// Discover 4-stem/6-stem role files in the stems dir (role from the filename suffix).
const ROLE = /_(vocals|drums|bass|other|guitar|piano)\.wav$/i;
const stemsDir = flag("stems-dir");
let stems: ScaffoldInputs["stems"];
if (stemsDir) {
  const files: Record<string, string> = {};
  for (const f of readdirSync(stemsDir)) {
    const m = f.match(ROLE);
    if (m) files[m[1].toLowerCase()] = f;
  }
  if (Object.keys(files).length) {
    const dir = rel(stemsDir);
    stems = { dir: dir.endsWith("/") ? dir : dir + "/", files };
  }
}

const alignArg = flag("align");
const startBeatArg = flag("start-beat");
const manifest = buildScaffold({
  title,
  artist: flag("artist"),
  key: flag("key"),
  bpm,
  beats: times,
  startBeat: startBeatArg !== undefined ? Number(startBeatArg) : 0,
  sourceFile: rel(source),
  stems,
  alignFile: alignArg ? rel(alignArg) : undefined,
  genius,
});

const json = JSON.stringify(manifest, null, 2) + "\n";
if (outPath) {
  writeFileSync(outPath, json);
  const rel = relative(process.cwd(), resolve(outPath));
  console.error(
    `Scaffolded ${manifest.sections.length} sections → ${rel}. Review bar counts, instrumental sections, and cues before generating.`,
  );
} else {
  process.stdout.write(json);
}
