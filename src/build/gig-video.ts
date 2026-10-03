/**
 * The gig video for a song's REAPER project: the visuals render's master,
 * `<slug>.visuals.mp4`, beside the manifest. Drafts (`.visuals-draft.mp4`) and
 * hand-named copies ("Creep - visuals (50MB).mp4") are never picked up.
 *
 * The render is in project time from 0 (count-in included, stretched to the
 * click), so the build places it 1:1 at the start of the project.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export function findGigVideo(dir: string, slug: string): string | undefined {
  const file = join(dir, `${slug}.visuals.mp4`);
  return existsSync(file) ? file : undefined;
}

/** The video's length in seconds, from ffprobe (the visuals already need ffmpeg). */
export function videoSeconds(file: string): number {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  const seconds = Number(out.trim());
  if (!(seconds > 0)) throw new Error(`can't read the length of ${file}`);
  return seconds;
}
