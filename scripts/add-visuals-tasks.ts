/**
 * Give a song's recipe the visuals render: timing → render → build.
 *
 *   npx tsx scripts/add-visuals-tasks.ts <song-dir> [--files <glob>]... [--dependencies <task>]...
 *
 * For a song whose recipe predates the render task. `--files` adds what the
 * scene loads beside it (e.g. `stills/**`), `--dependencies` a task that makes
 * one of those files. New songs get the tasks from `init-song` already.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { addVisualsTasks } from "../src/build/song-recipe.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { files: { type: "string", multiple: true }, dependencies: { type: "string", multiple: true } },
});
const dir = positionals[0];
if (!dir) {
  console.error("usage: npx tsx scripts/add-visuals-tasks.ts <song-dir> [--files <glob>]... [--dependencies <task>]...");
  process.exit(1);
}
const path = join(dir, "package.json");
const recipe = addVisualsTasks(JSON.parse(readFileSync(path, "utf8")), { files: values.files, dependencies: values.dependencies });
writeFileSync(path, JSON.stringify(recipe, null, 2) + "\n");
console.error(`${path}: timing → render → build`);
