/** What the gig CLIs ask of media files: ffprobe, and the audio binary. */

import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";

export const BIN = resolve(import.meta.dirname, "../../.claude/skills/clickbait/bin/clickbait-audio");

/** The first audio stream's fields by name (ffprobe prints them in its own order, not the order asked). */
function probe(file: string, entries: string): Record<string, string> {
  const out = execFileSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", entries, "-of", "default=nw=1", file], { encoding: "utf8" });
  return Object.fromEntries(out.trim().split("\n").map((line) => line.split("=") as [string, string]));
}

/** Seconds of encoder delay at the start of a file's audio (0 for WAV and the like). */
export function encoderDelay(file: string): number {
  const fields = probe(file, "stream=initial_padding,sample_rate");
  const padding = Number(fields.initial_padding);
  const rate = Number(fields.sample_rate);
  return padding > 0 && rate > 0 ? padding / rate : 0;
}

/** A file's length in seconds. */
export function mediaSeconds(file: string): number {
  const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).trim());
  if (!(seconds > 0)) throw new Error(`can't read the length of ${file}`);
  return seconds;
}

/** Integrated loudness (LUFS) of a file's first audio stream, or of `seconds` of it from `start`. */
export function loudness(file: string, span?: { start: number; seconds: number }): number {
  const cut = span ? ["-ss", String(span.start), "-t", String(span.seconds)] : [];
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", ...cut, "-i", file, "-map", "0:a:0", "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" });
  const found = [...r.stderr.matchAll(/^\s*I:\s+(-?[\d.]+) LUFS/gm)].pop();
  if (r.status !== 0 || !found) throw new Error(`can't measure the loudness of ${file}`);
  return Number(found[1]);
}
