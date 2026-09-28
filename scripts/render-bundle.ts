/**
 * Build a practice bundle end to end — one command instead of the manual dance.
 *
 *   npm run bundle:render -- songs/<artist>/<song>
 *
 * Stages:
 *   1. For EACH practice variant (full, minus-<part>, click-only — the manifest's
 *      stems, or its `bundle.variants` block; see src/build/bundle-variants.ts):
 *      a. Generate a NO-RIG render project with that variant's stems muted
 *         (Click + Cues + Stems all → master; the live rig would mute stems /
 *         route cues to hardware → silence).
 *      b. Render the master in REAPER (headless CLI) → <slug>[.<variant>].wav.
 *      c. Compress to Opus 96k (practice, not playback) and drop the WAV.
 *   2. Regenerate the LIVE project so the on-disk RPP keeps its stage routing.
 *   3. Assemble the bundle folder, then ZIP it → bundles/<slug>.zip (one download).
 *
 * Maintainer tooling: needs REAPER + ffmpeg on this machine. Band members only
 * ever get the resulting zip.
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SongManifestSchema } from "../src/manifest.js";
import { bundleVariants } from "../src/build/bundle-variants.js";
import { songSlug } from "../src/core/dsongl/index.js";
import type { Song } from "../src/core/dsongl/types.js";

const REAPER = "/Applications/REAPER.app/Contents/MacOS/REAPER";
// Repo root from this file's location, NOT the cwd: the per-song wireit `bundle`
// task runs this script from inside the song folder.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TSX = (rel: string) => `npx tsx ${JSON.stringify(join(ROOT, rel))}`;

const arg = process.argv[2];
if (!arg) {
  console.error("usage: npm run bundle:render -- songs/<artist>/<song>");
  process.exit(1);
}
const dir = resolve(arg);
const manifestName = readdirSync(dir).find((f) => f.endsWith(".song.json"));
if (!manifestName) {
  console.error(`no *.song.json in ${dir}`);
  process.exit(1);
}
const manifestPath = join(dir, manifestName);
const q = (s: string) => JSON.stringify(s);
// Ignore stdin (don't inherit it): REAPER/ffmpeg otherwise read from the parent's
// stdin, which eats lines when this script runs inside a `while read` batch loop.
const run = (cmd: string, env?: Record<string, string>) =>
  execSync(cmd, { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"], env: env ? { ...process.env, ...env } : process.env });

const manifest = SongManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
const slug = songSlug({ title: manifest.title, artist: manifest.artist } as Song);
const variants = bundleVariants(manifest, slug);
const n = variants.length;

// 1. One no-rig render per variant.
variants.forEach((v, i) => {
  const step = `[${i + 1}/${n} ${v.id}]`;
  const renderName = v.file.replace(/\.opus$/, "");
  const wav = join(dir, `${renderName}.wav`);
  const opus = join(dir, v.file);
  const mute = v.mute.length ? ` --mute-stems ${q(v.mute.join(","))}` : "";

  console.error(`→ ${step} generating no-rig render project…`);
  run(`${TSX("src/build/generate.ts")} ${q(manifestPath)} --render-name ${q(renderName)}${mute}`, { CLICKBAIT_RIG: "/nonexistent" });
  const rpp = join(dir, `${slug}.RPP`);
  if (!existsSync(rpp)) { console.error(`no .RPP was produced at ${rpp}`); process.exit(1); }

  console.error(`→ ${step} rendering in REAPER…`);
  run(`${q(REAPER)} -renderproject ${q(rpp)}`);
  if (!existsSync(wav)) { console.error(`render produced no WAV at ${wav}`); process.exit(1); }

  console.error(`→ ${step} compressing to Opus…`);
  run(`ffmpeg -y -loglevel error -i ${q(wav)} -c:a libopus -b:a 96k ${q(opus)}`);
  rmSync(wav);
});

// 2. Restore the live (rig) project.
console.error("→ restoring the live project…");
run(`${TSX("src/build/generate.ts")} ${q(manifestPath)}`);

// 3. Bundle + zip.
console.error("→ assembling + zipping the bundle…");
run(`${TSX("src/build/bundle.ts")} ${q(dir)}`);
const zip = join(ROOT, "bundles", `${slug}.zip`);
rmSync(zip, { force: true });
run(`cd ${q(join(ROOT, "bundles"))} && zip -r -q ${q(`${slug}.zip`)} ${q(slug)}`);

console.error(`\n✓ ${slug}\n  bundle:   bundles/${slug}/\n  download: ${zip}`);
