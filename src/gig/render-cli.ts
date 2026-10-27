/**
 * A song's 16:9 review render (see render.ts).
 *
 *   npx tsx src/gig/render-cli.ts <phone video> <srt> <out.mp4> [--board <board> --sync <sync.json> --mix <share>]
 *
 * Without --board the sound is the phone's own.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loudness, mediaSeconds } from "./media.js";
import { finalGainDb, mixArgs, mixGains, reviewArgs } from "./render.js";
import { boardSpan, type Sync } from "./timeline.js";

const args = process.argv.slice(2);
const [phone, srt, out] = args;
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const board = option("--board");
const syncFile = option("--sync");
if (!out || !board !== !syncFile) {
  console.error("usage: npx tsx src/gig/render-cli.ts <phone video> <srt> <out.mp4> [--board <board> --sync <sync.json> --mix <share>]");
  process.exit(1);
}
const sync: Sync | undefined = syncFile ? JSON.parse(readFileSync(syncFile, "utf8")) : undefined;
const mix = Number(option("--mix") ?? 0);
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
  mkdirSync(dirname(out), { recursive: true });
  execFileSync("ffmpeg", reviewArgs({ phone, mix: mixed, srt, gainDb: finalGainDb(loudness(mixed)), out }), { stdio: "inherit" });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
