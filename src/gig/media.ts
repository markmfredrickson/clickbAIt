/** What the gig CLIs ask of media files: ffprobe, and the audio binary. */

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

export const BIN = resolve(import.meta.dirname, "../../.claude/skills/clickbait/bin/clickbait-audio");

function probe(file: string, entries: string): string {
  return execFileSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", entries, "-of", "default=nw=1:nk=1", file], { encoding: "utf8" }).trim();
}

/** Seconds of encoder delay at the start of a file's audio (0 for WAV and the like). */
export function encoderDelay(file: string): number {
  const [padding, rate] = probe(file, "stream=initial_padding,sample_rate").split("\n").map(Number);
  return padding > 0 && rate > 0 ? padding / rate : 0;
}

/** A file's length in seconds. */
export function mediaSeconds(file: string): number {
  const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).trim());
  if (!(seconds > 0)) throw new Error(`can't read the length of ${file}`);
  return seconds;
}
