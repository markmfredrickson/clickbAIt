/**
 * Practice Bundle builder.
 *
 * Assembles a self-contained folder per song that a band member can open in any
 * browser — no repo, no REAPER, no server. It plays a pre-rendered mix while the
 * teleprompter UI scrolls the lyrics in sync, driven off the <audio> element's
 * clock (not OSC).
 *
 * Usage:
 *   npm run bundle -- songs/<artist>/<song>        [--out <dir>]
 *
 * Inputs (already produced by the normal pipeline), found in the song folder:
 *   - <slug>.lyrics-display.json  — from `npm run generate` (the built display)
 *   - mix.opus | mix.ogg | mix.m4a | mix.wav — the rendered show mix
 *     (render the song's RPP in REAPER and save it into the song folder).
 *
 * Output: bundles/<slug>/ with index.html + style.css + teleprompter.js +
 *         song.json + the mix + README.txt. The display data is also inlined
 *         into index.html (window.__SONG_DATA__) so it works over file://.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { resolve, join } from "path";

function fail(msg: string): never {
  console.error("error: " + msg);
  process.exit(1);
}

function parseArgs(argv: string[]): { songDir: string; outDir?: string } {
  const args = argv.slice(2);
  let songDir: string | undefined;
  let outDir: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out" && args[i + 1]) outDir = args[++i];
    else if (!songDir && !args[i].startsWith("-")) songDir = args[i];
  }
  if (!songDir) {
    fail(
      "usage: npm run bundle -- songs/<artist>/<song> [--out <dir>]\n" +
      "  e.g. npm run bundle -- songs/<artist>/<song>",
    );
  }
  return { songDir, outDir };
}

const { songDir: songDirArg, outDir: outArg } = parseArgs(process.argv);
const repoRoot = process.cwd();
const songDir = resolve(repoRoot, songDirArg);
if (!existsSync(songDir)) fail(`song folder not found: ${songDir}`);

// The built teleprompter display (there is exactly one per song folder).
const displayFiles = readdirSync(songDir).filter((f) => f.endsWith(".lyrics-display.json"));
if (displayFiles.length === 0) {
  fail(
    `no *.lyrics-display.json in ${songDir}\n` +
    `  Build the song first:  npm run generate -- ${songDirArg}/<slug>.song.json`,
  );
}
if (displayFiles.length > 1) fail(`multiple *.lyrics-display.json in ${songDir}: ${displayFiles.join(", ")}`);
const displayPath = join(songDir, displayFiles[0]);

// Display data — mark it a bundle so the client drives off <audio>, not OSC.
const songData = JSON.parse(readFileSync(displayPath, "utf8"));
songData.bundle = true;
const slug: string = songData.slug ?? displayFiles[0].replace(".lyrics-display.json", "");
const outDir = resolve(repoRoot, outArg ?? `bundles/${slug}`);

// The rendered mix (smallest format first). Prefer a slug-named render
// (<slug>.opus, what current RPPs render to); fall back to the older mix.* name.
const exts = ["opus", "ogg", "m4a", "wav"];
const mixCandidates = [...exts.map((e) => `${slug}.${e}`), ...exts.map((e) => `mix.${e}`)];
const mixFile = mixCandidates.find((n) => existsSync(join(songDir, n)));
if (!mixFile) {
  fail(
    `no mix file in ${songDir}\n` +
    `  Looked for: ${mixCandidates.join(", ")}\n` +
    `  Render the song's RPP in REAPER and save the result into the song folder.`,
  );
}
// Name the bundle's audio with the song slug so it's identifiable on someone's
// drive (e.g. "<song>-<artist>.opus"), like the .RPP.
const bundleMix = `${slug}.${mixFile.split(".").pop()}`;

const clientDir = resolve(repoRoot, "src", "teleprompter", "client");
if (!existsSync(clientDir)) fail(`teleprompter client dir missing: ${clientDir}`);

// Assemble.
mkdirSync(outDir, { recursive: true });
copyFileSync(join(clientDir, "style.css"), join(outDir, "style.css"));
copyFileSync(join(clientDir, "teleprompter.js"), join(outDir, "teleprompter.js"));
copyFileSync(join(songDir, mixFile), join(outDir, bundleMix));
writeFileSync(join(outDir, "song.json"), JSON.stringify(songData, null, 2)); // for HTTP-served debugging

// index.html — put the mix player in the sticky header, and inline the display
// data before teleprompter.js so the bundle works when opened over file://.
const indexHtmlSrc = readFileSync(join(clientDir, "index.html"), "utf8");
const audioTag =
  `    <audio id="mix-audio" src="${bundleMix}" controls preload="auto" style="width:100%;margin-top:0.5rem"></audio>`;
const songScript = `  <script>window.__SONG_DATA__ = ${JSON.stringify(songData)};</script>`;
const indexHtml = indexHtmlSrc
  .replace(/(<\/header>)/, `${audioTag}\n  $1`)
  .replace(/(<script src="teleprompter\.js"><\/script>)/, `${songScript}\n  $1`);
writeFileSync(join(outDir, "index.html"), indexHtml);

writeFileSync(
  join(outDir, "README.txt"),
  `${songData.title} — practice bundle\n\n` +
    `How to use:\n` +
    `  1. Double-click index.html to open it in your browser.\n` +
    `  2. Press play on the audio control; the lyrics scroll automatically.\n` +
    `  3. Use the Offset slider to get the lyrics a beat or two ahead.\n\n` +
    `If audio doesn't play when opened directly (some browsers block file:// audio):\n` +
    `  cd into this folder and run:  npx serve .\n` +
    `  then open the URL it prints.\n`,
);

console.log(`wrote ${outDir}`);
console.log(`  ${songData.title} — ${songData.artist ?? "?"} (${songData.bpm} BPM)`);
console.log(`  mix: ${mixFile}  |  ${songData.display?.sections?.length ?? 0} sections, ${songData.words?.length ?? 0} words`);
console.log(`\nOpen ${join(outDir, "index.html")} in a browser to test.`);
