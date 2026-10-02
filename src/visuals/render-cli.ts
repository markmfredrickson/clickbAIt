/**
 * Render a song's scene to `<slug>.visuals.mp4` beside the manifest.
 *
 *   npx tsx src/visuals/render-cli.ts <manifest.song.json> [--scene file] [--fps 30] [--size 1920x1080]
 *
 * Reads the build's own outputs: `<slug>.lyrics-display.json` for the
 * project-time curve, `<slug>.rows.json` for the sections and
 * `<slug>.beat-features.json` for the stems. The scene defaults to
 * `<slug>.scene.js`.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { SongManifestSchema } from "../manifest.js";
import { toSlug } from "../core/dsongl/slug.js";
import { renderScene } from "./render.js";
import { readMedia } from "./media.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { scene: { type: "string" }, fps: { type: "string", default: "30" }, size: { type: "string", default: "1920x1080" } },
});
const manifestPath = positionals[0];
if (!manifestPath) {
  console.error("usage: npx tsx src/visuals/render-cli.ts <manifest.song.json> [--scene file] [--fps 30] [--size 1920x1080]");
  process.exit(1);
}
const dir = dirname(resolve(manifestPath));
const manifest = SongManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
const slug = toSlug([manifest.title, manifest.artist].filter(Boolean).join("-"));
const file = (suffix: string) => join(dir, `${slug}${suffix}`);
const json = (suffix: string) => JSON.parse(readFileSync(file(suffix), "utf8"));

const scene = values.scene ? resolve(values.scene) : file(".scene.js");
if (!existsSync(scene)) throw new Error(`no scene at ${scene}`);
const [width, height] = values.size!.split("x").map(Number);
const out = file(".visuals.mp4");

const started = Date.now();
await renderScene({
  scene,
  timing: json(".lyrics-display.json"),
  sections: json(".rows.json").sections,
  features: existsSync(file(".beat-features.json")) ? json(".beat-features.json") : undefined,
  media: readMedia(dirname(scene)).clips,
  fps: Number(values.fps),
  width,
  height,
  out,
  onFrame: (i, total) => {
    if (i % 300 === 0 || i === total - 1) {
      const s = (Date.now() - started) / 1000;
      process.stderr.write(`frame ${i + 1}/${total}  ${s.toFixed(0)}s  ${((i + 1) / s).toFixed(1)} fps\n`);
    }
  },
});
console.error(`wrote ${out} in ${((Date.now() - started) / 1000).toFixed(0)}s`);
