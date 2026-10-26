/**
 * The singer's voice for a phone video, split out with demucs.
 *
 *   npx tsx src/gig/vocals-cli.ts <phone video> <out.wav> [--board <board> --sync <sync.json>]
 *
 * With --board, the vocal comes from the board recording over the stretch the
 * video covers (see boardSpan); without, from the video's own sound. Only the
 * vocal stem is kept.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { BIN, mediaSeconds } from "./media.js";
import { boardSpan } from "./timeline.js";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const [phone, out] = args;
const board = flag("board");
const syncFile = flag("sync");
if (!out || !board !== !syncFile) {
  console.error("usage: npx tsx src/gig/vocals-cli.ts <phone video> <out.wav> [--board <board> --sync <sync.json>]");
  process.exit(1);
}

mkdirSync(dirname(out), { recursive: true });
const work = mkdtempSync(join(dirname(out), ".vocals-"));
try {
  let source = phone;
  if (board) {
    const span = boardSpan(JSON.parse(readFileSync(syncFile!, "utf8")), mediaSeconds(phone));
    source = join(work, "cut.wav");
    execFileSync("ffmpeg", ["-v", "error", "-ss", String(span.start), "-t", String(span.seconds), "-i", board, "-vn", "-c:a", "pcm_s16le", source]);
  }
  execFileSync(BIN, ["split", source, "--output-dir", work, "--model", "4stem"], { stdio: ["ignore", "ignore", "inherit"] });
  renameSync(join(work, `${basename(source, extname(source))}_vocals.wav`), out);
} finally {
  rmSync(work, { recursive: true, force: true });
}
