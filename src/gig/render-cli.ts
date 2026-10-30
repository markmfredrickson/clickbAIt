/**
 * A song's 16:9 review render, or with --final its finished video (see render.ts).
 *
 *   npx tsx src/gig/render-cli.ts <phone video> <words.json> <out.mp4> [--final]
 *     [--board <board> --sync <sync.json> --mix <share>] [--in <seconds>] [--out <seconds>] [--crop <x>,<y>,<size>[,<angle>]]
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
import type { Crop, Cut } from "./gig.js";
import { loudness, mediaSeconds } from "./media.js";
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
    "usage: npx tsx src/gig/render-cli.ts <phone video> <words.json> <out.mp4> [--final] [--board <board> --sync <sync.json> --mix <share>] [--in <seconds>] [--out <seconds>] [--crop <x>,<y>,<size>[,<angle>]]",
  );
  process.exit(1);
}
const sync: Sync | undefined = syncFile ? JSON.parse(readFileSync(syncFile, "utf8")) : undefined;
const mix = Number(option("--mix") ?? 0);
const cut: Cut = {
  ...(option("--in") !== undefined ? { in: Number(option("--in")) } : {}),
  ...(option("--out") !== undefined ? { out: Number(option("--out")) } : {}),
};
const cropArg = option("--crop")?.split(",").map(Number);
const crop: Crop | undefined = cropArg
  ? { x: cropArg[0], y: cropArg[1], size: cropArg[2], ...(cropArg[3] !== undefined ? { angle: cropArg[3] } : {}) }
  : undefined;
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
  const ffmpegArgs = final ? finalArgs({ phone, mix: mixed, gainDb, cut, crop, out }) : reviewArgs({ phone, mix: mixed, gainDb, cut, out });
  execFileSync("ffmpeg", ffmpegArgs, { stdio: "inherit" });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
