/**
 * A song's 16:9 review render (see render.ts).
 *
 *   npx tsx src/gig/render-cli.ts <phone video> <words.json> <out.mp4>
 *     [--board <board> --sync <sync.json> --mix <share>] [--in <seconds>] [--out <seconds>]
 *
 * Without --board the sound is the phone's own. The captions come from the
 * words file (see captions-cli.ts), cut to match the video.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkCut, cutLines } from "./edges.js";
import type { Cut } from "./gig.js";
import { loudness, mediaSeconds } from "./media.js";
import { finalGainDb, mixArgs, mixGains, reviewArgs } from "./render.js";
import { captionsSrt, type CaptionLine } from "./srt.js";
import { boardSpan, type Sync } from "./timeline.js";

const args = process.argv.slice(2);
const [phone, wordsFile, out] = args;
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const board = option("--board");
const syncFile = option("--sync");
if (!out || !board !== !syncFile) {
  console.error(
    "usage: npx tsx src/gig/render-cli.ts <phone video> <words.json> <out.mp4> [--board <board> --sync <sync.json> --mix <share>] [--in <seconds>] [--out <seconds>]",
  );
  process.exit(1);
}
const sync: Sync | undefined = syncFile ? JSON.parse(readFileSync(syncFile, "utf8")) : undefined;
const mix = Number(option("--mix") ?? 0);
const cut: Cut = {
  ...(option("--in") !== undefined ? { in: Number(option("--in")) } : {}),
  ...(option("--out") !== undefined ? { out: Number(option("--out")) } : {}),
};
const lines: CaptionLine[] = JSON.parse(readFileSync(wordsFile, "utf8")).lines;
checkCut(cut, lines);
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
  const srt = join(tmp, "captions.srt");
  writeFileSync(srt, captionsSrt(cutLines(lines, cut)));
  // The loudness that matters is the kept part's.
  const kept = { start: cut.in ?? 0, seconds: (cut.out ?? videoSeconds) - (cut.in ?? 0) };
  mkdirSync(dirname(out), { recursive: true });
  execFileSync("ffmpeg", reviewArgs({ phone, mix: mixed, srt, gainDb: finalGainDb(loudness(mixed, kept)), cut, out }), { stdio: "inherit" });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
