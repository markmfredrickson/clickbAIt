/**
 * Live preview of a song's scene: plays the mix and redraws the scene on every
 * save.
 *
 *   npx tsx src/visuals/preview-cli.ts <manifest.song.json> [--scene file] [--audio file] [--port 8095] [--size 1920x1080]
 *
 * The scene defaults to `<slug>.scene.js` and the audio to the full bundle mix
 * `<slug>.opus` (click and cues included, which helps judge sync).
 */

import { readFileSync, existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { SongManifestSchema } from "../manifest.js";
import { toSlug } from "../core/dsongl/slug.js";
import { startPreview } from "./preview.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    scene: { type: "string" },
    audio: { type: "string" },
    port: { type: "string", default: "8095" },
    size: { type: "string", default: "1920x1080" },
  },
});
const manifestPath = positionals[0];
if (!manifestPath) {
  console.error("usage: npx tsx src/visuals/preview-cli.ts <manifest.song.json> [--scene file] [--audio file] [--port 8095] [--size 1920x1080]");
  process.exit(1);
}
const dir = dirname(resolve(manifestPath));
const manifest = SongManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
const slug = toSlug([manifest.title, manifest.artist].filter(Boolean).join("-"));
const file = (suffix: string) => join(dir, `${slug}${suffix}`);

const need = (path: string, what: string) => {
  if (!existsSync(path)) throw new Error(`no ${what} at ${path}`);
  return path;
};
const [width, height] = values.size!.split("x").map(Number);

const preview = await startPreview({
  scene: need(values.scene ? resolve(values.scene) : file(".scene.js"), "scene"),
  timing: need(file(".lyrics-display.json"), "lyrics display (run the build)"),
  rows: need(file(".rows.json"), "rows (run the build)"),
  features: file(".beat-features.json"),
  audio: need(values.audio ? resolve(values.audio) : file(".opus"), "mix (run the bundle, or pass --audio)"),
  port: Number(values.port),
  width,
  height,
});
console.error(`preview at ${preview.url} — save the scene to see it change; Ctrl-C to stop`);
if (process.platform === "darwin") execFile("open", ["-a", "Google Chrome", preview.url]);
