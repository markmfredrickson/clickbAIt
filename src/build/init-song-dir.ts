/**
 * The folder `song:init` creates: wherever `--dir` says, at any depth, since
 * every band lays its songs out differently. The recipe reaches the repo with
 * `rel`, so it works from whatever depth the folder lands at.
 */

import { existsSync, mkdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export function initSongDir(dirArg: string | undefined, root: string): { songDir: string; rel: string } {
  if (!dirArg) throw new Error("--dir is required: the song's folder, e.g. --dir songs/my-band/artist/song");
  const songDir = resolve(root, dirArg);
  if (existsSync(join(songDir, "package.json"))) {
    throw new Error(
      `refusing to overwrite existing recipe: ${relative(root, join(songDir, "package.json"))} ` +
        "(delete it first if you really mean to re-init this song)",
    );
  }
  mkdirSync(songDir, { recursive: true });
  return { songDir, rel: relative(songDir, root) || "." };
}
