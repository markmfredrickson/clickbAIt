/**
 * A song's 16:9 review render, or with --final its finished video (see render.ts).
 *
 *   npx tsx src/gig/render-cli.ts <phone video> <words.json> <out.mp4> [--final]
 *     [--board <board> --sync <sync.json> --mix <share>] [--in <seconds>] [--out <seconds>] [--crop <crop as JSON> [--motion <motion.json> --people <people.json>]]
 *
 * Without --board the sound is the phone's own. The captions come from the
 * words file (see captions-cli.ts), cut to match the video. They are commented
 * out until their timing is fixed; the words file still checks the cut.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkCut } from "./edges.js";
import { type CropKey, pathFilter, perspectiveFilter } from "./crop.js";
import { cropPath, type CurveCrop, type PeopleSample } from "./follow.js";
import type { MotionSample } from "./motion.js";
import type { Cut } from "./gig.js";
import { frameRate, loudness, mediaSeconds } from "./media.js";
import { finalArgs, finalGainDb, mixArgs, mixGains, reviewArgs } from "./render.js";
import type { CaptionLine } from "./srt.js";
import { boardSpan, type Sync } from "./timeline.js";

const args = process.argv.slice(2);
const [phone, wordsFile, out] = args;
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const final = args.includes("--final");
const board = option("--board");
const syncFile = option("--sync");
if (!out || !board !== !syncFile) {
  console.error(
    "usage: npx tsx src/gig/render-cli.ts <phone video> <words.json> <out.mp4> [--final] [--board <board> --sync <sync.json> --mix <share>] [--in <seconds>] [--out <seconds>] [--crop <crop as JSON> [--motion <motion.json> --people <people.json>]]",
  );
  process.exit(1);
}
const sync: Sync | undefined = syncFile ? JSON.parse(readFileSync(syncFile, "utf8")) : undefined;
const mix = Number(option("--mix") ?? 0);
const cut: Cut = {
  ...(option("--in") !== undefined ? { in: Number(option("--in")) } : {}),
  ...(option("--out") !== undefined ? { out: Number(option("--out")) } : {}),
};
const cropArg = option("--crop");
const motionFile = option("--motion");
const peopleFile = option("--people");
const lines: CaptionLine[] = JSON.parse(readFileSync(wordsFile, "utf8")).lines;
// The live alignment this checks against is not reliable enough to overrule a
// cut someone chose, so a failed check only warns.
try {
  checkCut(cut, lines);
} catch (e) {
  console.warn(`warning: ${(e as Error).message}`);
}
const videoSeconds = mediaSeconds(phone);

const gains = mixGains({
  boardLufs: board && sync ? loudness(board, boardSpan(sync, videoSeconds)) : null,
  phoneLufs: loudness(phone),
  mix,
});
const tmp = mkdtempSync(join(tmpdir(), "clickbait-render-"));
try {
  const mixed = join(tmp, "mix.flac");
  execFileSync("ffmpeg", mixArgs({ phone, board, sync, videoSeconds, gains, out: mixed }), { stdio: "inherit" });
  // const srt = join(tmp, "captions.srt");
  // writeFileSync(srt, captionsSrt(cutLines(lines, cut)));
  // The loudness that matters is the kept part's.
  const kept = { start: cut.in ?? 0, seconds: (cut.out ?? videoSeconds) - (cut.in ?? 0) };
  mkdirSync(dirname(out), { recursive: true });
  const gainDb = finalGainDb(loudness(mixed, kept));
  const crop = cropArg ? cropFilter(JSON.parse(cropArg), cut.in ?? 0, cut.out ?? videoSeconds) : undefined;
  const ffmpegArgs = final ? finalArgs({ phone, mix: mixed, gainDb, cut, crop, out }) : reviewArgs({ phone, mix: mixed, gainDb, cut, out });
  execFileSync("ffmpeg", ffmpegArgs, { stdio: "inherit" });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

/** The crop's filter: keyed boxes, or curves sampled twice a second (from the camera's motion when they follow it). */
function cropFilter(c: CropKey[] | CurveCrop, start: number, end: number): string {
  const fps = frameRate(phone);
  if (Array.isArray(c)) return perspectiveFilter(c, { start, fps });
  const samples: MotionSample[] | null = motionFile ? JSON.parse(readFileSync(motionFile, "utf8")).samples : null;
  const people: PeopleSample[] | null = peopleFile ? JSON.parse(readFileSync(peopleFile, "utf8")).samples : null;
  const times = samples ? samples.map((s) => s.t) : Array.from({ length: Math.floor((end - start) * 2) + 1 }, (_, i) => start + i / 2);
  return pathFilter(cropPath(times, samples, people, c, 1920, 1080), { start, fps });
}
