/**
 * Build a practice bundle end to end — one command instead of the manual dance.
 *
 *   npm run bundle:render -- songs/<artist>/<song>
 *
 * Stages:
 *   1. Generate a NO-RIG render project (Click + Cues + Stems all → master,
 *      unmuted; the live rig would mute stems / route cues to hardware → silence).
 *   2. Render the master in REAPER (headless CLI) → <slug>.wav.
 *   3. Compress to Opus (<slug>.opus) and drop the WAV.  ← final media stage
 *   4. Regenerate the LIVE project so the on-disk RPP keeps its stage routing.
 *   5. Assemble the bundle folder, then ZIP it → bundles/<slug>.zip (one download).
 *
 * Maintainer tooling: needs REAPER + ffmpeg on this machine. Band members only
 * ever get the resulting zip.
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";

const REAPER = "/Applications/REAPER.app/Contents/MacOS/REAPER";

const arg = process.argv[2];
if (!arg) {
  console.error("usage: npm run bundle:render -- songs/<artist>/<song>");
  process.exit(1);
}
const dir = resolve(arg);
const manifest = readdirSync(dir).find((f) => f.endsWith(".song.json"));
if (!manifest) {
  console.error(`no *.song.json in ${dir}`);
  process.exit(1);
}
const manifestPath = join(dir, manifest);
const q = (s: string) => JSON.stringify(s);
// Ignore stdin (don't inherit it): REAPER/ffmpeg otherwise read from the parent's
// stdin, which eats lines when this script runs inside a `while read` batch loop.
const run = (cmd: string, env?: Record<string, string>) =>
  execSync(cmd, { stdio: ["ignore", "inherit", "inherit"], env: env ? { ...process.env, ...env } : process.env });

// 1. No-rig render project (everything → master).
console.error("→ [1/5] generating no-rig render project…");
run(`npx tsx src/build/generate.ts ${q(manifestPath)}`, { CLICKBAIT_RIG: "/nonexistent" });

const rpp = readdirSync(dir).find((f) => f.toLowerCase().endsWith(".rpp"));
if (!rpp) { console.error("no .RPP was produced"); process.exit(1); }
const slug = rpp.replace(/\.rpp$/i, "");
const wav = join(dir, `${slug}.wav`);
const opus = join(dir, `${slug}.opus`);

// 2. Render in REAPER.
console.error("→ [2/5] rendering the mix in REAPER…");
run(`${q(REAPER)} -renderproject ${q(join(dir, rpp))}`);
if (!existsSync(wav)) { console.error(`render produced no WAV at ${wav}`); process.exit(1); }

// 3. Compress to Opus.
console.error("→ [3/5] compressing to Opus…");
run(`ffmpeg -y -i ${q(wav)} -c:a libopus -b:a 128k ${q(opus)}`);
rmSync(wav);

// 4. Restore the live (rig) project.
console.error("→ [4/5] restoring the live project…");
run(`npx tsx src/build/generate.ts ${q(manifestPath)}`);

// 5. Bundle + zip.
console.error("→ [5/5] assembling + zipping the bundle…");
run(`npx tsx src/build/bundle.ts ${q(dir)}`);
const zip = resolve(`bundles/${slug}.zip`);
rmSync(zip, { force: true });
run(`cd bundles && zip -r -q ${q(`${slug}.zip`)} ${q(slug)}`);

console.error(`\n✓ ${slug}\n  bundle:   bundles/${slug}/\n  download: ${zip}`);
