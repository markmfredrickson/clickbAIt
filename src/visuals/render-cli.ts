/**
 * Render a song's scene beside the manifest.
 *
 *   npm run visuals:render -- <manifest.song.json> [--draft] [--scene file] [--tail s] [--until s] [--out file]
 *
 * By default it writes the gig master, `<slug>.visuals.mp4`: 1080p, encoded
 * near-lossless, no audio. `--draft` writes `<slug>.visuals-draft.mp4` for
 * checking a scene: 360p, the whole song, a fast (hardware where possible)
 * encoder, with the song's mix in as AAC.
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
  options: {
    scene: { type: "string" },
    fps: { type: "string", default: "30" },
    size: { type: "string" },
    tail: { type: "string", default: "0" },
    until: { type: "string" },
    draft: { type: "boolean", default: false },
    audio: { type: "string" },
    out: { type: "string" },
  },
});
const manifestPath = positionals[0];
if (!manifestPath) {
  console.error("usage: npx tsx src/visuals/render-cli.ts <manifest.song.json> [--scene file] [--fps 30] [--size 1920x1080] [--tail seconds] [--until seconds] [--out file] [--draft] [--audio file]");
  process.exit(1);
}
const dir = dirname(resolve(manifestPath));
const manifest = SongManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
const slug = toSlug([manifest.title, manifest.artist].filter(Boolean).join("-"));
const file = (suffix: string) => join(dir, `${slug}${suffix}`);
const json = (suffix: string) => JSON.parse(readFileSync(file(suffix), "utf8"));

const scene = values.scene ? resolve(values.scene) : file(".scene.js");
if (!existsSync(scene)) throw new Error(`no scene at ${scene}`);
// A draft is 360p with the mix in, the whole song, to check a scene quickly;
// the full render is the 1080p gig master.
const [width, height] = (values.size ?? (values.draft ? "640x360" : "1920x1080")).split("x").map(Number);
const out = values.out ? resolve(values.out) : file(values.draft ? ".visuals-draft.mp4" : ".visuals.mp4");
const audio = values.audio ? resolve(values.audio) : values.draft && existsSync(file(".opus")) ? file(".opus") : undefined;

const started = Date.now();
await renderScene({
  scene,
  timing: json(".lyrics-display.json"),
  sections: json(".rows.json").sections,
  features: existsSync(file(".beat-features.json")) ? json(".beat-features.json") : undefined,
  media: readMedia(dirname(scene)).clips,
  fps: Number(values.fps),
  tail: Number(values.tail),
  until: values.until ? Number(values.until) : undefined,
  draft: values.draft,
  audio,
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
