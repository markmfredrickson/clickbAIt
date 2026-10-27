/**
 * A song's captions, from its alignment, on the video's timeline.
 *
 *   npx tsx src/gig/captions-cli.ts <align.json> <out prefix> [--sync <sync.json>]
 *
 * Writes <prefix>.words.json (every word and line in video seconds, for the
 * vertical clips' word-by-word captions), <prefix>.srt (line captions to
 * upload beside a video) and <prefix>.flags.json (words stranded far from the
 * rest of their line, to check by ear; the captions keep them as aligned). --sync when the vocal was cut from the board; without
 * it the alignment is already on the video's own sound.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { captionsSrt, strandedWords } from "./srt.js";
import { toVideoTime, type Sync } from "./timeline.js";

interface Aligned {
  words: { text: string; startMs: number; endMs: number }[];
  lines: { text: string; wordRange: [number, number] }[];
}

const args = process.argv.slice(2);
const [alignFile, prefix] = args;
const i = args.indexOf("--sync");
if (!prefix) {
  console.error("usage: npx tsx src/gig/captions-cli.ts <align.json> <out prefix> [--sync <sync.json>]");
  process.exit(1);
}
const sync: Sync | null = i >= 0 ? JSON.parse(readFileSync(args[i + 1], "utf8")) : null;
const aligned: Aligned = JSON.parse(readFileSync(alignFile, "utf8"));
const at = (ms: number) => Math.round(toVideoTime(ms / 1000, sync) * 1000) / 1000;

const words = aligned.words.map((w) => ({ text: w.text, start: at(w.startMs), end: at(w.endMs) }));
const lines = aligned.lines.map((l) => ({ text: l.text, words: words.slice(l.wordRange[0], l.wordRange[1]) }));

mkdirSync(dirname(prefix), { recursive: true });
writeFileSync(`${prefix}.words.json`, JSON.stringify({ lines }, null, 1) + "\n");
writeFileSync(`${prefix}.srt`, captionsSrt(lines));
const stranded = strandedWords(lines);
writeFileSync(`${prefix}.flags.json`, JSON.stringify({ stranded }, null, 1) + "\n");
if (stranded.length) console.error(`${stranded.length} stranded word${stranded.length > 1 ? "s" : ""}: see ${prefix}.flags.json`);
