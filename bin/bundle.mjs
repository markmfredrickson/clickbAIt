#!/usr/bin/env node

// src/bundle.ts
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve, join } from "path";
function fail(msg) {
  console.error("error: " + msg);
  process.exit(1);
}
function parseArgs(argv) {
  const args = argv.slice(2);
  let target2;
  let outDir2;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out" && args[i + 1]) {
      outDir2 = args[++i];
    } else if (!target2 && !args[i].startsWith("-")) {
      target2 = args[i];
    }
  }
  if (!target2) {
    fail(
      "usage: npx tsx src/bundle.ts <artist>/<slug> [--out <dir>]\n  e.g. npx tsx src/bundle.ts aimee-mann/save-me-aimee-mann"
    );
  }
  return { target: target2, outDir: outDir2 };
}
var { target, outDir: outArg } = parseArgs(process.argv);
var slash = target.indexOf("/");
if (slash < 0) fail(`target must be "<artist>/<slug>", got "${target}"`);
var artist = target.slice(0, slash);
var slug = target.slice(slash + 1);
var repoRoot = process.cwd();
var artistDir = resolve(repoRoot, "songs", artist);
var songJsonPath = resolve(artistDir, `${slug}.json`);
var mixCandidates = ["mix.opus", "mix.ogg", "mix.m4a", "mix.wav"];
var mixFile = mixCandidates.find((n) => existsSync(resolve(artistDir, n)));
var mixPath = mixFile ? resolve(artistDir, mixFile) : resolve(artistDir, "mix.wav");
var clientDir = resolve(repoRoot, "src", "teleprompter", "client");
var outDir = resolve(repoRoot, outArg ?? `bundles/${slug}`);
if (!existsSync(songJsonPath)) {
  fail(
    `song JSON not found at ${songJsonPath}
  Generate it first with:
    npx tsx bin/generate.mjs songs/${artist}/${slug.replace(/-.*$/, "")}.ts songs/${artist}`
  );
}
if (!mixFile) {
  fail(
    `no mix file found in ${artistDir}
  Looked for: ${mixCandidates.join(", ")}
  Render the RPP in REAPER and save the result as one of those names.`
  );
}
if (!existsSync(clientDir)) {
  fail(`client dir missing: ${clientDir}`);
}
mkdirSync(outDir, { recursive: true });
copyFileSync(join(clientDir, "style.css"), join(outDir, "style.css"));
copyFileSync(join(clientDir, "teleprompter.js"), join(outDir, "teleprompter.js"));
copyFileSync(mixPath, join(outDir, mixFile));
var songData = JSON.parse(readFileSync(songJsonPath, "utf8"));
songData.bundle = true;
writeFileSync(join(outDir, "song.json"), JSON.stringify(songData, null, 2));
var indexHtmlSrc = readFileSync(join(clientDir, "index.html"), "utf8");
var audioTag = `    <audio id="mix-audio" src="${mixFile}" controls preload="auto" style="width:100%;margin-top:0.5rem"></audio>`;
var songScript = `  <script>window.__SONG_DATA__ = ${JSON.stringify(songData)};</script>`;
var indexHtml = indexHtmlSrc.replace(/(<\/header>)/, `${audioTag}
  $1`).replace(/(<script src="teleprompter\.js"><\/script>)/, `${songScript}
  $1`);
writeFileSync(join(outDir, "index.html"), indexHtml);
var readme = `${songData.title} \u2014 practice bundle

How to use:
  1. Double-click index.html to open in your browser.
  2. Press play on the audio control; lyrics scroll automatically.
  3. Use the Offset slider to get lyrics a beat or two ahead.

If audio doesn't play when opened directly (some browsers block file:// audio):
  cd into this folder and run:
    npx serve .
  then open the URL it prints.
`;
writeFileSync(join(outDir, "README.txt"), readme);
console.log(`wrote ${outDir}`);
console.log(`  ${songData.title} \u2014 ${songData.artist ?? "?"}`);
console.log(`  ${songData.sections?.length ?? 0} sections, ${songData.bpm} BPM`);
console.log(`
Open ${join(outDir, "index.html")} in a browser to test.`);
