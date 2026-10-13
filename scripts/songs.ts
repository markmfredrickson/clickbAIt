/**
 * Run a recipe task across the catalog: every song folder whose package.json
 * is a wireit unit (the one `song:init` writes). Wireit skips songs whose
 * inputs are unchanged, so a full sweep is mostly no-ops.
 *
 *   npm run songs -- songs/my-band              # build every changed song under a folder
 *   npm run songs -- bundle songs/a songs/b     # any task the recipes have, several folders
 *   npm run songs -- songs/my-band/artist/song  # one song
 *   npm run songs -- build --force songs/a      # run it even where wireit thinks it's fresh
 *   npm run songs                               # the folders listed in .clickbait.json
 *
 * Songs are found at any depth under the folders, so any layout works. See
 * src/core/songs-args.ts for .clickbait.json.
 *
 * --force is for when clickbait's own code changed: wireit only watches a
 * task's declared inputs, not the tool code it runs. It clears the named
 * task's wireit state only, so its dependencies (align, and the stem split
 * behind it) still run only if their own inputs changed.
 *
 * A song whose recipe has no such task is skipped and listed (recipes from
 * before a task existed lack it).
 */

import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseSongsArgs, readClickbaitConfig } from "../src/core/songs-args.js";

let parsed;
try {
  parsed = parseSongsArgs(process.argv.slice(2), readClickbaitConfig(process.cwd()).songs);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
const { task, roots, force } = parsed;

/** The song's wireit recipe, or null if its package.json isn't one. */
function recipe(dir: string): Record<string, unknown> | null {
  const pj = join(dir, "package.json");
  if (!existsSync(pj)) return null;
  try {
    return JSON.parse(readFileSync(pj, "utf8")).wireit ?? null;
  } catch {
    return null;
  }
}

const dirs = [
  ...new Set(
    roots.flatMap((r) =>
      execFileSync("find", [r, "-name", "*.song.json", "-not", "-path", "*/.wireit/*"], { encoding: "utf8" })
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(dirname),
    ),
  ),
]
  .filter((d) => recipe(d) !== null)
  .sort();

let ok = 0;
const failed: string[] = [];
const without: string[] = [];
for (const d of dirs) {
  if (!(task in recipe(d)!)) {
    without.push(d);
    continue;
  }
  // Wireit keeps each task's state in .wireit/<task name in hex>.
  if (force) rmSync(join(d, ".wireit", Buffer.from(task).toString("hex")), { recursive: true, force: true });
  try {
    // No wireit output cache: it keeps a second copy of every output (each
    // visuals render is GBs), and freshness comes from fingerprints anyway.
    execSync(`npm run ${task}`, { cwd: d, stdio: "inherit", env: { ...process.env, WIREIT_CACHE: process.env.WIREIT_CACHE ?? "none" } });
    ok++;
  } catch {
    failed.push(d);
  }
}
const ran = dirs.length - without.length;
console.error(`\n${task}: ${ok}/${ran} songs${failed.length ? `, FAILED: ${failed.join(", ")}` : ""}.`);
if (without.length) console.error(`no ${task} task in the recipe (skipped): ${without.join(", ")}`);
if (failed.length) process.exit(1);
