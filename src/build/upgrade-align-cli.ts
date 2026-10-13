/**
 * Upgrade every song's recipe to the desilence align task (see upgradeAlign in
 * song-recipe.ts): a binary `align` task is replaced, and a multitrack song with
 * none gets one. Prints what it did per song; a recipe already upgraded, or
 * with an align command it doesn't recognize, is left alone and listed.
 *
 * Usage:
 *   npx tsx src/build/upgrade-align-cli.ts [filter]
 */

import { execSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { alignSource, upgradeAlign } from "./song-recipe.js";

const root = resolve(import.meta.dirname, "..", "..");
const filter = process.argv[2];
const manifests = execSync("find songs -name '*.song.json' -not -path '*/.wireit/*' -not -path 'songs/archive/*'", { cwd: root, encoding: "utf8" })
  .trim()
  .split("\n")
  .filter((m) => m && (!filter || m.includes(filter)))
  .sort();

for (const m of manifests) {
  const dir = join(root, dirname(m));
  const pj = join(dir, "package.json");
  let recipe: Record<string, unknown>;
  try {
    recipe = JSON.parse(readFileSync(pj, "utf8"));
  } catch {
    continue;
  }
  if (!recipe.wireit) continue;
  if (readdirSync(dir).filter((f) => f.endsWith(".song.json")).length > 1) {
    console.log(`– ${dirname(m)}: several manifests, skipped`);
    continue;
  }
  const source = alignSource(dir, JSON.parse(readFileSync(join(root, m), "utf8")));
  if (!source) {
    console.log(`– ${dirname(m)}: no alignment or vocal audio`);
    continue;
  }
  try {
    const next = upgradeAlign(recipe, { rel: relative(dir, root), slug: basename(m, ".song.json"), ...source });
    if (next === recipe) {
      console.log(`  ${dirname(m)}: already upgraded`);
      continue;
    }
    writeFileSync(pj, JSON.stringify(next, null, 2) + "\n");
    console.log(`✓ ${dirname(m)}: ${source.alignStem} (lyrics from the ${source.lyricsFrom})`);
  } catch (err) {
    console.log(`✗ ${dirname(m)}: ${(err as Error).message}`);
  }
}
