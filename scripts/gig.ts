/**
 * Run a gig's pipeline. Run from the repo root.
 *
 *   npm run gig -- songs/gigs/2026-08-08            # sync every song (the default task)
 *   npm run gig -- songs/gigs/2026-08-08 sync       # any task the gig recipe has
 *   npm run gig -- songs/gigs/2026-08-08 stamp      # pin the gig to both repos' commits
 *       [--songs <commit>] [--clickbait <commit>] [--force]
 *
 * Every run rewrites the gig's package.json from its gig.json (the recipe is
 * derived, see src/gig/gig-recipe.ts), then runs the task there with wireit.
 */

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { readGig } from "../src/gig/gig.js";
import { gigRecipe } from "../src/gig/gig-recipe.js";
import { stamp } from "../src/gig/stamp.js";

const [dirArg, task = "sync", ...rest] = process.argv.slice(2);
if (!dirArg) {
  console.error("usage: npm run gig -- <gig folder> [task | stamp [--songs <commit>] [--clickbait <commit>] [--force]]");
  process.exit(1);
}
const root = process.cwd();
const dir = resolve(dirArg);

try {
  if (task === "stamp") {
    const flag = (name: string) => {
      const i = rest.indexOf(`--${name}`);
      return i >= 0 ? rest[i + 1] : undefined;
    };
    stamp(dir, root, { songs: flag("songs"), clickbait: flag("clickbait"), force: rest.includes("--force") });
    console.log(`stamped ${relative(root, dir)}/gig.lock.json`);
  } else {
    const recipe = gigRecipe(readGig(dir, root), relative(dir, root));
    writeFileSync(resolve(dir, "package.json"), JSON.stringify(recipe, null, 2) + "\n");
    execSync(`npm run ${task}`, { cwd: dir, stdio: "inherit", env: { ...process.env, WIREIT_CACHE: process.env.WIREIT_CACHE ?? "none" } });
  }
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
