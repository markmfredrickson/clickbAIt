#!/usr/bin/env node
/**
 * Full pipeline for one song: regenerate RPP → REAPER CLI render → ffmpeg
 * Opus encode → bundle assemble.
 *
 * Usage:
 *   node bin/render-bundle.mjs <songs-dir-relative-ts-file>
 *   e.g. node bin/render-bundle.mjs songs/chappell-roan/pink-pony-club.ts
 *
 * Assumes:
 *   - REAPER.app installed at /Applications/REAPER.app
 *   - ffmpeg on $PATH (with libopus)
 *   - bin/ already built (node scripts/build.mjs)
 */

import { execFileSync, execSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import { dirname, basename, resolve, join } from "node:path";

const REAPER = "/Applications/REAPER.app/Contents/MacOS/REAPER";

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

const tsFile = process.argv[2];
if (!tsFile) fail("usage: node bin/render-bundle.mjs <song.ts>");
const tsPath = resolve(tsFile);
if (!existsSync(tsPath)) fail(`song file not found: ${tsPath}`);
const songDir = dirname(tsPath);

if (!existsSync(REAPER)) fail(`REAPER not found at ${REAPER}`);
try { execSync("ffmpeg -version", { stdio: "ignore" }); }
catch { fail("ffmpeg not on PATH (brew install ffmpeg)"); }

// 1. Regenerate RPP + JSON
console.log(`[1/4] generate    ${tsFile}`);
execFileSync("npx", ["tsx", "src/generate.ts", tsPath, songDir], { stdio: "inherit" });

// Find the RPP we just produced (only one *.RPP per song dir).
const rpps = readdirSync(songDir).filter(f => f.endsWith(".RPP"));
if (rpps.length !== 1) fail(`expected exactly one .RPP in ${songDir}, found ${rpps.length}`);
const rppPath = resolve(songDir, rpps[0]);

// Drop any stale mix.* before render so we know what came out.
for (const f of ["mix.wav", "mix.opus", "mix.ogg", "mix.m4a"]) {
  const p = resolve(songDir, f);
  if (existsSync(p)) unlinkSync(p);
}

// 2. Render via REAPER (RPP has RENDER_PATTERN=mix → produces mix.wav)
console.log(`[2/4] render WAV  ${rppPath}`);
execFileSync(REAPER, ["-nosplash", "-renderproject", rppPath], { stdio: "inherit" });
const wavPath = resolve(songDir, "mix.wav");
if (!existsSync(wavPath)) fail(`render produced no mix.wav in ${songDir}`);

// 3. ffmpeg → Opus 128k
console.log(`[3/4] encode opus ${wavPath}`);
const opusPath = resolve(songDir, "mix.opus");
execFileSync("ffmpeg", ["-y", "-i", wavPath, "-c:a", "libopus", "-b:a", "128k", opusPath], { stdio: "inherit" });
unlinkSync(wavPath);

// 4. Bundle. The RPP and the show JSON share the same slug basename.
const slug = basename(rppPath, ".RPP");
const artist = basename(songDir);
console.log(`[4/4] bundle      ${artist}/${slug}`);
execFileSync("node", ["bin/bundle.mjs", `${artist}/${slug}`], { stdio: "inherit" });

console.log(`\nDone. bundles/${slug}/`);
