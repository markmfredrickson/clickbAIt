/**
 * What was said around a song: Whisper on the vocal before its first sung word
 * and after its last, as phrases on the video's timeline (see edges.ts).
 *
 *   npx tsx src/gig/edges-cli.ts <vocals.flac> <align.json> <out.json> [--sync <sync.json>]
 *
 * --sync when the vocal was cut from the board, as for captions-cli.ts.
 *
 * Output: { firstWord, lastWord, end, head: Phrase[], tail: Phrase[] }, all in
 * video seconds: where singing starts and stops, where the video ends, and
 * what was said before and after.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { edgePhrases, edgeWindows, type Aligned, type Phrase, type Window } from "./edges.js";
import { BIN, mediaSeconds } from "./media.js";
import { toVideoTime, type Sync } from "./timeline.js";

const args = process.argv.slice(2);
const [vocals, alignFile, out] = args;
const i = args.indexOf("--sync");
if (!out) {
  console.error("usage: npx tsx src/gig/edges-cli.ts <vocals.flac> <align.json> <out.json> [--sync <sync.json>]");
  process.exit(1);
}
const sync: Sync | null = i >= 0 ? JSON.parse(readFileSync(args[i + 1], "utf8")) : null;
const aligned: Aligned = JSON.parse(readFileSync(alignFile, "utf8"));
const seconds = mediaSeconds(vocals);
const { head, tail } = edgeWindows(aligned, seconds);
/** Shorter than this, there's no room for anyone to say anything. */
const MIN_S = 0.5;

const tmp = mkdtempSync(join(tmpdir(), "clickbait-edges-"));
function heard(name: string, w: Window): Phrase[] {
  if (w.end - w.start < MIN_S) return [];
  const wav = join(tmp, `${name}.wav`);
  execFileSync("ffmpeg", ["-v", "error", "-ss", String(w.start), "-to", String(w.end), "-i", vocals, "-ac", "1", "-ar", "16000", wav]);
  const json = execFileSync(BIN, ["transcribe", wav, "--model", "large-v3"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return edgePhrases(JSON.parse(json).words, w, sync);
}
try {
  const round = (s: number) => Math.round(toVideoTime(s, sync) * 1000) / 1000;
  const edges = {
    firstWord: round(head.end),
    lastWord: round(tail.start),
    end: round(seconds),
    head: heard("head", head),
    tail: heard("tail", tail),
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(edges, null, 1) + "\n");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
