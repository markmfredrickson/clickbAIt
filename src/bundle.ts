/**
 * Practice Bundle builder.
 *
 * Assembles a self-contained directory per song that the band can open in
 * any browser. Plays a pre-rendered mix.wav while the existing teleprompter
 * UI scrolls in sync (no server, no OSC).
 *
 * Usage:
 *   npx tsx src/bundle.ts <artist>/<slug> [--out <dir>]
 *
 * Prerequisites (user must do first):
 *   1. Generate the song: `npx tsx bin/generate.mjs songs/<artist>/<slug>.ts songs/<artist>`
 *      → writes `songs/<artist>/<slug>.json` and the RPP.
 *   2. Open the RPP in REAPER, render master → save as `songs/<artist>/mix.wav`.
 *
 * Output: `bundles/<slug>/` containing index.html + style.css + teleprompter.js
 *         + song.json (with `"bundle": true` added) + mix.wav + README.txt.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve, basename, join, dirname } from "path";

function fail(msg: string): never {
  console.error("error: " + msg);
  process.exit(1);
}

function parseArgs(argv: string[]): { target: string; outDir?: string } {
  const args = argv.slice(2);
  let target: string | undefined;
  let outDir: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out" && args[i + 1]) {
      outDir = args[++i];
    } else if (!target && !args[i].startsWith("-")) {
      target = args[i];
    }
  }
  if (!target) {
    fail(
      "usage: npx tsx src/bundle.ts <artist>/<slug> [--out <dir>]\n" +
      '  e.g. npx tsx src/bundle.ts aimee-mann/save-me-aimee-mann'
    );
  }
  return { target: target!, outDir };
}

const { target, outDir: outArg } = parseArgs(process.argv);

// Parse "<artist>/<slug>". slug is the JSON file's basename without .json,
// which is what generate.ts emits via songSlug().
const slash = target.indexOf("/");
if (slash < 0) fail(`target must be "<artist>/<slug>", got "${target}"`);
const artist = target.slice(0, slash);
const slug = target.slice(slash + 1);

// Resolve repo root. This file lives at src/bundle.ts; from the process cwd
// we expect the user runs from repo root.
const repoRoot = process.cwd();
const artistDir = resolve(repoRoot, "songs", artist);
const songJsonPath = resolve(artistDir, `${slug}.json`);
const mixWavPath = resolve(artistDir, "mix.wav");
const clientDir = resolve(repoRoot, "src", "teleprompter", "client");
const outDir = resolve(repoRoot, outArg ?? `bundles/${slug}`);

// Verify inputs.
if (!existsSync(songJsonPath)) {
  fail(
    `song JSON not found at ${songJsonPath}\n` +
    `  Generate it first with:\n` +
    `    npx tsx bin/generate.mjs songs/${artist}/${slug.replace(/-.*$/, "")}.ts songs/${artist}`
  );
}
if (!existsSync(mixWavPath)) {
  fail(
    `mix.wav not found at ${mixWavPath}\n` +
    `  Render it first:\n` +
    `    1. Open songs/${artist}/${slug}.RPP in REAPER\n` +
    `    2. File → Render (default settings are fine)\n` +
    `    3. Save as ${mixWavPath}`
  );
}
if (!existsSync(clientDir)) {
  fail(`client dir missing: ${clientDir}`);
}

// Assemble bundle.
mkdirSync(outDir, { recursive: true });

// 1. style.css + teleprompter.js — verbatim copies
copyFileSync(join(clientDir, "style.css"), join(outDir, "style.css"));
copyFileSync(join(clientDir, "teleprompter.js"), join(outDir, "teleprompter.js"));

// 2. mix.wav
copyFileSync(mixWavPath, join(outDir, "mix.wav"));

// 3. song.json with bundle:true merged in
const songData = JSON.parse(readFileSync(songJsonPath, "utf8"));
songData.bundle = true;
writeFileSync(join(outDir, "song.json"), JSON.stringify(songData, null, 2));

// 4. index.html — template: inject <audio id="mix-audio"> before <main>
const indexHtmlSrc = readFileSync(join(clientDir, "index.html"), "utf8");
const audioTag =
  '  <audio id="mix-audio" src="mix.wav" controls preload="auto" style="width:100%;margin-top:0.5rem"></audio>';
const indexHtml = indexHtmlSrc.replace(
  /<main id="lyrics-container"><\/main>/,
  `${audioTag}\n\n  <main id="lyrics-container"></main>`,
);
writeFileSync(join(outDir, "index.html"), indexHtml);

// 5. README.txt
const readme =
  `${songData.title} — practice bundle\n\n` +
  `How to use:\n` +
  `  1. Double-click index.html to open in your browser.\n` +
  `  2. Press play on the audio control; lyrics scroll automatically.\n` +
  `  3. Use the Offset slider to get lyrics a beat or two ahead.\n\n` +
  `If audio doesn't play when opened directly (some browsers block file:// audio):\n` +
  `  cd into this folder and run:\n` +
  `    npx serve .\n` +
  `  then open the URL it prints.\n`;
writeFileSync(join(outDir, "README.txt"), readme);

console.log(`wrote ${outDir}`);
console.log(`  ${songData.title} — ${songData.artist ?? "?"}`);
console.log(`  ${songData.sections?.length ?? 0} sections, ${songData.bpm} BPM`);
console.log(`\nOpen ${join(outDir, "index.html")} in a browser to test.`);
