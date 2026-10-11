/**
 * Run a recipe task across the catalog: every song folder whose package.json
 * is a wireit unit (the one `song:init` writes). Wireit skips songs whose
 * inputs are unchanged, so a full sweep is mostly no-ops.
 *
 *   npm run songs                        # build every changed song
 *   npm run songs -- bundle              # any task the recipes have
 *   npm run songs -- build sugar         # only songs whose path contains "sugar"
 *   npm run songs -- build --force       # run it even where wireit thinks it's fresh
 *
 * --force is for when clickbait's own code changed: wireit only watches a
 * task's declared inputs, not the tool code it runs. It clears the named
 * task's wireit state only, so its dependencies (align, and the stem split
 * behind it) still run only if their own inputs changed.
 *
 * A song whose recipe has no such task is skipped and listed (recipes from
 * before a task existed lack it). A flat folder holding several manifests has
 * no recipe; build those with `npm run song:build -- <manifest>`.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const force = args.includes("--force");
const [task = "build", filter] = args.filter((a) => a !== "--force");

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
    execSync("find songs -name '*.song.json'", { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(dirname),
  ),
]
  .filter((d) => recipe(d) !== null)
  .filter((d) => !filter || d.includes(filter))
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
    execSync(`npm run ${task}`, { cwd: d, stdio: "inherit" });
    ok++;
  } catch {
    failed.push(d);
  }
}
const ran = dirs.length - without.length;
console.error(`\n${task}: ${ok}/${ran} songs${failed.length ? `, FAILED: ${failed.join(", ")}` : ""}.`);
if (without.length) console.error(`no ${task} task in the recipe (skipped): ${without.join(", ")}`);
if (failed.length) process.exit(1);
