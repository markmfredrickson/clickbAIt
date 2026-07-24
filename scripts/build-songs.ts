/**
 * Fan out the per-song build over every song build unit. Incremental via wireit —
 * songs whose inputs are unchanged are skipped, so a full sweep is mostly no-ops.
 *
 *   npm run build:songs             # build (generate) every changed song
 *   npm run build:songs -- bundle   # render + bundle every changed song (REAPER)
 *
 * A song is a build unit once `init-song` has written its package.json (older
 * songs got theirs from the first `generate`). A flat folder holding several
 * manifests has no unit and is skipped — build those with `npm run generate`.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** A song folder is a build unit if its package.json is a wireit unit (the one
 *  `init-song` writes) — not just any package.json (e.g. the example-songs one). */
function isBuildUnit(dir: string): boolean {
  const pj = join(dir, "package.json");
  if (!existsSync(pj)) return false;
  try { return !!JSON.parse(readFileSync(pj, "utf8")).wireit; } catch { return false; }
}

const target = process.argv[2] === "bundle" ? "bundle" : "build";
const manifests = execSync("find songs -name '*.song.json'", { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean);
const dirs = [...new Set(manifests.map(dirname))].filter(isBuildUnit);

let ok = 0;
const failed: string[] = [];
for (const d of dirs) {
  try {
    execSync(`npm run ${target}`, { cwd: d, stdio: "inherit" });
    ok++;
  } catch {
    failed.push(d);
  }
}
console.error(`\n${target}: ${ok}/${dirs.length} song units${failed.length ? `, FAILED: ${failed.join(", ")}` : ""}.`);
if (failed.length) process.exit(1);
