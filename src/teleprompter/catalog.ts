/**
 * Which songs the teleprompter serves, and in what order the set runs.
 *
 * Folders named with --songs-dir are served as they are. Without them, the
 * relay reads `.clickbait.json`: every built song (a folder holding a
 * `*.lyrics-display.json`) under its "songs" folders, plus the "setlist" file
 * if there is one. The set list is the same file `practice-all.sh` reads, so
 * REAPER's tab order and the relay's song order come from one place.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { readClickbaitConfig } from "../core/songs-args.js";

export interface RelaySongs {
  /** Song folders to serve. */
  songsDirs: string[];
  /** Song folders in playing order, when a set list is configured. */
  setlist?: string[];
  /** Song folders with a manifest but no built lyrics-display, skipped. */
  unbuilt: string[];
}

export function relaySongs(named: string[], configDir: string): RelaySongs {
  if (named.length > 0) return { songsDirs: named, unbuilt: [] };
  const config = readClickbaitConfig(configDir);
  if (!config.songs || config.songs.length === 0) {
    throw new Error('name the songs with --songs-dir, or list their folders under "songs" in .clickbait.json');
  }
  const songsDirs: string[] = [];
  const unbuilt: string[] = [];
  for (const dir of songFolders(config.songs)) (isBuilt(dir) ? songsDirs : unbuilt).push(dir);
  const setlist = config.setlist ? readSetlist(config.setlist, configDir, songsDirs) : undefined;
  return { songsDirs, ...(setlist ? { setlist } : {}), unbuilt };
}

/**
 * The song folders a set list names, in order. One folder per line, relative
 * to `base`; `#` starts a comment, so a commented-out line drops that song.
 * Every entry must be one of the `built` song folders.
 */
export function readSetlist(file: string, base: string, built: string[]): string[] {
  const known = new Set(built);
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.replace(/#.*/, "").trim())
    .filter(Boolean)
    .map((entry) => {
      const dir = resolve(base, entry);
      if (!known.has(dir)) throw new Error(`${file}: ${entry} is not a built song folder`);
      return dir;
    });
}

/** Every folder holding a manifest under the given roots, outside hidden folders. */
function songFolders(roots: string[]): string[] {
  const found = roots.flatMap((r) =>
    execFileSync("find", [r, "-name", "*.song.json"], { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean)
      // Nothing under a hidden folder (.wireit, a .trash) is a song.
      .filter((m) => !relative(r, m).split(sep).some((part) => part.startsWith(".")))
      .map(dirname),
  );
  return [...new Set(found)].sort();
}

const isBuilt = (dir: string): boolean => readdirSync(dir).some((f) => f.endsWith(".lyrics-display.json"));

/** A built song folder's slug: the name of its one `<slug>.lyrics-display.json`. */
export function songSlugOf(dir: string): string {
  const found = readdirSync(dir).filter((f) => f.endsWith(".lyrics-display.json")).sort();
  if (found.length === 0) throw new Error(`no built lyrics display in ${dir}`);
  if (found.length > 1) throw new Error(`${found.length} lyrics displays in ${dir} (${found.join(", ")})`);
  return found[0].slice(0, -".lyrics-display.json".length);
}
