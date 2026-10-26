/**
 * Pin a gig to the commits it was played from: `gig.lock.json` records the
 * songs repo's commit and clickbAIt's, so the show can be rebuilt as it was
 * (check both out, rebuild). Written once, at the gig; never overwritten.
 *
 * A checkout with uncommitted changes isn't recreated by its commit, so that is
 * an error unless forced, and a forced lock lists which repo was dirty. The gig's
 * own folder doesn't count: its gig.json is often new on the night.
 */

import { execFileSync } from "node:child_process";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

export interface StampOpts {
  /** Commits to record instead of the checkouts' current ones (any form git accepts). */
  songs?: string;
  clickbait?: string;
  /** Stamp even though a checkout has uncommitted changes. */
  force?: boolean;
}

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** The full SHA of `commit` in the repo at `cwd`. */
function resolveCommit(cwd: string, repo: string, commit: string): string {
  try {
    return git(cwd, "rev-parse", "--verify", "--quiet", `${commit}^{commit}`);
  } catch {
    throw new Error(`the ${repo} repo has no commit ${commit}`);
  }
}

/** Uncommitted changes in the repo at `cwd`, leaving out anything under `skip`. */
function uncommitted(cwd: string, skip?: string): string[] {
  const top = git(cwd, "rev-parse", "--show-toplevel");
  const prefix = skip ? relative(top, realpathSync(skip)) + "/" : undefined;
  return git(cwd, "status", "--porcelain", "--untracked-files=all")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3))
    .filter((path) => !prefix || !path.startsWith(prefix));
}

export function stamp(gigDir: string, root: string, opts: StampOpts = {}): void {
  const file = join(gigDir, "gig.lock.json");
  if (existsSync(file)) throw new Error(`${file} already exists; a gig is stamped once`);

  const repos = [
    { name: "songs" as const, cwd: gigDir, commit: opts.songs, skip: gigDir },
    { name: "clickbait" as const, cwd: root, commit: opts.clickbait, skip: undefined },
  ];
  const lock: { songs?: string; clickbait?: string; dirty?: string[] } = {};
  const dirty: string[] = [];
  for (const r of repos) {
    if (r.commit !== undefined) {
      lock[r.name] = resolveCommit(r.cwd, r.name, r.commit);
      continue;
    }
    lock[r.name] = resolveCommit(r.cwd, r.name, "HEAD");
    const changes = uncommitted(r.cwd, r.skip);
    if (changes.length === 0) continue;
    if (!opts.force) {
      throw new Error(`the ${r.name} checkout has uncommitted changes (${changes.slice(0, 5).join(", ")}${changes.length > 5 ? ", …" : ""}); commit them, pass its commit, or force`);
    }
    dirty.push(r.name);
  }
  if (dirty.length) lock.dirty = dirty;
  writeFileSync(file, JSON.stringify(lock, null, 2) + "\n");
}
