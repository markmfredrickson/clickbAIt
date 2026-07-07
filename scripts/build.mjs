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
  // Mark as external:
  // - native/binary-addon deps
  // - dotenv: uses CommonJS `require('fs')` internally which breaks in our
  //   ESM bundle. Node resolves it from node_modules at runtime instead.
  external: ["nodejs-whisper", "fsevents", "dotenv", "cheerio"],
};

await esbuild.build({
  ...shared,
  entryPoints: ["src/build/generate.ts"],
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

await esbuild.build({
  ...shared,
  entryPoints: ["src/authoring/lookup/cli.ts"],
  outfile: "bin/lookup.mjs",
  banner: { js: "#!/usr/bin/env node" },
});
console.log("  bin/lookup.mjs");

console.log("Build done.");
