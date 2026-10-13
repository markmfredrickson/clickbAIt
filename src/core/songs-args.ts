/**
 * What `npm run songs` runs and where: a recipe task, and the folders to look
 * for songs under. Nothing assumes a layout — the folders are named on the
 * command line, or listed once in `.clickbait.json`:
 *
 *   { "songs": ["songs/deermouse", "songs/duo"] }
 *
 * Folders on the command line replace the configured ones. With neither, the
 * command refuses rather than guessing where songs live.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export interface SongsArgs {
  task: string;
  roots: string[];
  force: boolean;
}

export interface ClickbaitConfig {
  /** Folders `npm run songs` searches when none are named. */
  songs?: string[];
}

const isDir = (p: string): boolean => existsSync(p) && statSync(p).isDirectory();

export function parseSongsArgs(argv: string[], defaults: string[] = []): SongsArgs {
  const force = argv.includes("--force");
  const words = argv.filter((a) => a !== "--force");
  let task = "build";
  if (words.length > 0 && !isDir(words[0])) task = words.shift()!;
  return { task, roots: songRoots(words, defaults), force };
}

/** The folders to search: the ones named, else the configured ones; every one must exist. */
export function songRoots(words: string[], defaults: string[] = []): string[] {
  for (const w of words) {
    if (!isDir(w)) throw new Error(`not a folder: ${w}`);
  }
  const roots = words.length > 0 ? words : defaults;
  if (roots.length === 0) {
    throw new Error('name the folder(s) to build, e.g. `npm run songs -- build songs`, or list them under "songs" in .clickbait.json');
  }
  for (const r of roots) {
    if (!isDir(r)) throw new Error(`configured song folder not found: ${r}`);
  }
  return roots;
}

/** The `.clickbait.json` in `dir`, with its song folders resolved against `dir`. Empty if there is none. */
export function readClickbaitConfig(dir: string): ClickbaitConfig {
  const file = join(dir, ".clickbait.json");
  if (!existsSync(file)) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`${file}: ${(err as Error).message}`);
  }
  const songs = (raw as { songs?: unknown }).songs;
  if (songs === undefined) return {};
  if (!Array.isArray(songs) || !songs.every((s) => typeof s === "string")) {
    throw new Error(`${file}: "songs" must be a list of folders`);
  }
  return { songs: songs.map((s) => resolve(dir, s)) };
}
