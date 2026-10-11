/**
 * The song a `song:` command works on, from its argument: the song folder or
 * its `.song.json`, whichever the person typed. A folder must hold exactly
 * one manifest; with several (a flat folder of songs) the person names one.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export function songArg(arg: string): { dir: string; manifest: string } {
  const path = resolve(arg);
  if (existsSync(path) && statSync(path).isDirectory()) {
    const found = readdirSync(path).filter((f) => f.endsWith(".song.json")).sort();
    if (found.length === 0) throw new Error(`no .song.json in ${path}`);
    if (found.length > 1) throw new Error(`${found.length} manifests in ${path} (${found.join(", ")}): name the one you mean`);
    return { dir: path, manifest: join(path, found[0]) };
  }
  if (existsSync(path) && basename(path).endsWith(".song.json")) return { dir: dirname(path), manifest: path };
  throw new Error(`no such song folder or manifest: ${arg}`);
}

/** songArg for a command line: prints the usage (no argument) or the problem, and exits. */
export function songArgOrExit(arg: string | undefined, usage: string): { dir: string; manifest: string } {
  if (!arg) {
    console.error(usage);
    process.exit(1);
  }
  try {
    return songArg(arg);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
