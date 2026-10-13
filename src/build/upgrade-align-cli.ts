/**
 * Upgrade every song's recipe to the desilence align task (see upgradeAlign in
 * song-recipe.ts): a binary `align` task is replaced, and a multitrack song with
 * none gets one. Prints what it did per song; a recipe already upgraded, or
 * with an align command it doesn't recognize, is left alone and listed.
 *
 * Usage:
 *   npx tsx src/build/upgrade-align-cli.ts [folder...]   # default: the folders in .clickbait.json
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { readClickbaitConfig, songRoots } from "../core/songs-args.js";
import { alignSource, upgradeAlign } from "./song-recipe.js";

const root = resolve(import.meta.dirname, "..", "..");
let roots: string[];
try {
  roots = songRoots(process.argv.slice(2).map((a) => resolve(a)), readClickbaitConfig(root).songs);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
const manifests = roots
  .flatMap((r) =>
    execFileSync("find", [relative(root, r) || ".", "-name", "*.song.json", "-not", "-path", "*/.wireit/*"], { cwd: root, encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean),
  )
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
