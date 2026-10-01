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
 *   - <slug>.rows.json            — also from generate: what the prompter's panes show
 *   - <slug>.charts.json          — optional; used only for a song built before rows files
 *   - the score files drum charts come from, whose bars are drawn here as SVG
 *   - mix.opus | mix.ogg | mix.m4a | mix.wav — the rendered show mix
 *     (render the song's RPP in REAPER and save it into the song folder).
 *
 * Output: bundles/<slug>/ with index.html + style.css + teleprompter.js +
 *         song.json + the mix + README.txt. The display data (rows and drawn
 *         staffs included) is also inlined into index.html
 *         (window.__SONG_DATA__), with the music font, so it works over file://.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { resolve, join } from "path";
import { buildClient } from "../teleprompter/build-client.js";
import { SongManifestSchema } from "../manifest.js";
import { bundleVariants, type BundleVariant } from "./bundle-variants.js";
import { rowsFromDisplay } from "../teleprompter/build-rows.js";
import { notationBars, notationCss, renderBars } from "../charts/notation-svg.js";
import { ALPHATAB_DIR } from "../teleprompter/alphatab-files.js";

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

// The rendered mixes. Every variant the manifest asks for (full, minus-<part>,
// click-only — see bundle-variants.ts) that has actually been rendered is
// carried; the full mix must exist. Files are already slug-named on disk.
const manifestFile = readdirSync(songDir).find((f) => f.endsWith(".song.json"));
if (!manifestFile) fail(`no *.song.json in ${songDir}`);
const manifest = SongManifestSchema.parse(JSON.parse(readFileSync(join(songDir, manifestFile), "utf8")));
const wanted = bundleVariants(manifest, slug);
const variants: BundleVariant[] = wanted.filter((v) => existsSync(join(songDir, v.file)));
for (const v of wanted) {
  if (!variants.includes(v)) console.error(`warning: variant "${v.id}" not rendered (${v.file} missing) — skipped`);
}
const full = variants.find((v) => v.id === "full") ?? variants[0];
if (!full) {
  fail(
    `no rendered mix in ${songDir}\n` +
    `  Looked for: ${wanted.map((v) => v.file).join(", ")}\n` +
    `  Render with:  npm run bundle:render -- ${songDirArg}`,
  );
}
songData.variants = variants.map(({ id, label, file }) => ({ id, label, file }));

// The rows the prompter's panes show: the bundle has no relay to ask, so they
// ride along in the display data. A song built before rows files gets them
// laid out from its display and charts file, as the relay would.
const rowsPath = join(songDir, `${slug}.rows.json`);
const chartsPath = join(songDir, `${slug}.charts.json`);
if (existsSync(rowsPath)) {
  songData.rows = JSON.parse(readFileSync(rowsPath, "utf8"));
} else {
  const charts = existsSync(chartsPath) ? JSON.parse(readFileSync(chartsPath, "utf8")) : null;
  songData.rows = rowsFromDisplay(songData, charts ? { chords: charts.chords, charts: charts.charts } : null);
}

// Drum staffs, drawn now: a bundle has no relay to serve alphaTab or the
// score, so it carries each bar its drum charts show as SVG, by channel and
// score bar, and the music font they're drawn in.
let notationStyle = "";
const drawnCharts = notationBars(songData.rows);
if (drawnCharts.length) {
  songData.notation = {};
  for (const chart of drawnCharts) {
    songData.notation[chart.id] = await renderBars(new Uint8Array(readFileSync(join(songDir, chart.source))), chart.track, chart.bars);
  }
  notationStyle = `  <style>${notationCss(new Uint8Array(readFileSync(join(ALPHATAB_DIR, "font/Bravura.woff2"))))}</style>\n`;
}

const clientDir = resolve(repoRoot, "src", "teleprompter", "client");
if (!existsSync(clientDir)) fail(`teleprompter client dir missing: ${clientDir}`);

// Build the client from TS so the bundle carries a freshly compiled copy.
await buildClient(clientDir);

// Assemble.
mkdirSync(outDir, { recursive: true });
copyFileSync(join(clientDir, "style.css"), join(outDir, "style.css"));
copyFileSync(join(clientDir, "teleprompter.js"), join(outDir, "teleprompter.js"));
for (const v of variants) copyFileSync(join(songDir, v.file), join(outDir, v.file));
writeFileSync(join(outDir, "song.json"), JSON.stringify(songData, null, 2)); // for HTTP-served debugging

// index.html — put the mix in the header's playback controls (the page's own
// play button drives it), and inline the display data before teleprompter.js
// so the bundle works when opened over file://.
const indexHtmlSrc = readFileSync(join(clientDir, "index.html"), "utf8");
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const variantSelect = variants.length > 1
  ? `    <label>Mix\n` +
    `      <select id="mix-variant" title="Which parts play (click and cues always do)">\n` +
    variants.map((v) => `        <option value="${esc(v.file)}"${v === full ? " selected" : ""}>${esc(v.label)}</option>`).join("\n") + `\n` +
    `      </select>\n    </label>\n`
  : "";
const audioTag =
  variantSelect +
  `    <audio id="mix-audio" src="${esc(full.file)}" preload="auto"></audio>`;
const songScript = `  <script>window.__SONG_DATA__ = ${JSON.stringify(songData)};</script>`;
const indexHtml = indexHtmlSrc
  .replace(/<div id="bundle-player"><\/div>/, `<div id="bundle-player">\n${audioTag}\n      </div>`)
  .replace(/(<script src="teleprompter\.js"><\/script>)/, `${songScript}\n  $1`)
  .replace(/<\/head>/, `${notationStyle}</head>`);
writeFileSync(join(outDir, "index.html"), indexHtml);

writeFileSync(
  join(outDir, "README.txt"),
  `${songData.title} — practice bundle\n\n` +
    `How to use:\n` +
    `  1. Double-click index.html to open it in your browser.\n` +
    `  2. Press play at the top (or the space bar); the display follows.\n` +
    `     Click a section in the strip under the title to jump to it.\n` +
    (variants.length > 1
      ? `     "Mix" picks which parts play: the full mix, minus your own part\n` +
        `     (practice against the rest of the band), or click only. The audio\n` +
        `     files are also plain .opus you can copy to a phone or player:\n` +
        variants.map((v) => `       ${v.file}  —  ${v.label}\n`).join("")
      : "") +
    `  3. Use the Offset slider to get the lyrics a beat or two ahead.\n` +
    `  4. To drill a part: pick it from "Loop" — it repeats that section.\n` +
    `     "Speed" slows playback down (pitch preserved).\n` +
    `  5. The gear button picks what shows (lyrics, chords, drums) and in\n` +
    `     what order.\n\n` +
    `If audio doesn't play when opened directly (some browsers block file:// audio):\n` +
    `  cd into this folder and run:  npx serve .\n` +
    `  then open the URL it prints.\n`,
);

console.log(`wrote ${outDir}`);
console.log(`  ${songData.title} — ${songData.artist ?? "?"} (${songData.bpm} BPM)`);
console.log(`  mixes: ${variants.map((v) => v.id).join(", ")}  |  ${songData.display?.sections?.length ?? 0} sections, ${songData.words?.length ?? 0} words`);
console.log(`\nOpen ${join(outDir, "index.html")} in a browser to test.`);
