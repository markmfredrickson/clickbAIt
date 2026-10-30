/**
 * A song's 16:9 review render, or with --final its finished video (see render.ts).
 *
 *   npx tsx src/gig/render-cli.ts <phone video> <words.json> <out.mp4> [--final]
 *     [--board <board> --sync <sync.json> --mix <share>] [--in <seconds>] [--out <seconds>] [--crop <crop as JSON> [--motion <motion.json> --people <people.json>]]
 *     [--grade <grade as JSON> [--levels <levels.json>]]
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
import { cropFilter } from "./crop-filter.js";
import { gradeFilter, smoothLevels, type LevelsSample } from "./grade.js";
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
    "usage: npx tsx src/gig/render-cli.ts <phone video> <words.json> <out.mp4> [--final] [--board <board> --sync <sync.json> --mix <share>] [--in <seconds>] [--out <seconds>] [--crop <crop as JSON> [--motion <motion.json> --people <people.json>]] [--grade <grade as JSON> [--levels <levels.json>]]",
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
const gradeArg = option("--grade");
const levelsFile = option("--levels");
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
  const span = { start: cut.in ?? 0, end: cut.out ?? videoSeconds };
  const crop = cropArg ? cropFilter(phone, JSON.parse(cropArg), span, { motion: motionFile, people: peopleFile }) : undefined;
  const grade = gradeArg ? gradeOf(JSON.parse(gradeArg)) : undefined;
  const ffmpegArgs = final ? finalArgs({ phone, mix: mixed, gainDb, cut, crop, grade, out }) : reviewArgs({ phone, mix: mixed, gainDb, cut, out });
  execFileSync("ffmpeg", ffmpegArgs, { stdio: "inherit" });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

/** The grade's filters, with the levels smoothed so they change only as fast as the light. */
function gradeOf(g: Parameters<typeof gradeFilter>[1] & { smooth: number }): string | undefined {
  const samples: LevelsSample[] | null = levelsFile ? JSON.parse(readFileSync(levelsFile, "utf8")).samples : null;
  return gradeFilter(samples && smoothLevels(samples, g.smooth), g, { start: cut.in ?? 0, fps: frameRate(phone) });
}
