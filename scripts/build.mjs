#!/usr/bin/env node
/**
 * Bundle clickbait bin scripts with esbuild.
 *
 * Produces:
 *   bin/generate.mjs      — clickbait-generate entry point
 *   bin/teleprompter.mjs  — clickbait-teleprompter entry point
 *
 * Usage: node scripts/build.mjs
 */

import * as esbuild from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("bin", { recursive: true });

const shared = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // Mark native deps as external — they rely on binary addons
  external: ["nodejs-whisper", "fsevents"],
};

await esbuild.build({
  ...shared,
  entryPoints: ["src/generate.ts"],
  outfile: "bin/generate.mjs",
  banner: { js: "#!/usr/bin/env node" },
});
console.log("  bin/generate.mjs");

await esbuild.build({
  ...shared,
  entryPoints: ["scripts/teleprompter.ts"],
  outfile: "bin/teleprompter.mjs",
  banner: { js: "#!/usr/bin/env node" },
});
console.log("  bin/teleprompter.mjs");

console.log("Build done.");
