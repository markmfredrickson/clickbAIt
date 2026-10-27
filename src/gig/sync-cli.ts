/**
 * Where a phone video starts in the board recording.
 *
 *   npx tsx src/gig/sync-cli.ts <board> <phone video> <out.sync.json> [--after <prev.sync.json> <prev phone video>]
 *
 * Runs `clickbait-audio offset`, whose decoder leaves each file's encoder delay
 * in, and moves the offset to the files' real timelines (what ffmpeg plays).
 * --after searches only the board after the previous song's video ends.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { BIN, encoderDelay, mediaSeconds } from "./media.js";
import { boardEnd, correctOffset } from "./timeline.js";

const args = process.argv.slice(2);
const [board, phone, out] = args;
const after = args.indexOf("--after");
if (!out || (after >= 0 && !args[after + 2])) {
  console.error("usage: npx tsx src/gig/sync-cli.ts <board> <phone video> <out.sync.json> [--after <prev.sync.json> <prev phone video>]");
  process.exit(1);
}
const boardDelay = encoderDelay(board);
// The binary's board timeline keeps the encoder delay, so the search start does too.
const from = after >= 0 ? boardEnd(JSON.parse(readFileSync(args[after + 1], "utf8")), mediaSeconds(args[after + 2])) + boardDelay : 0;
const found = JSON.parse(
  execFileSync(BIN, ["offset", board, phone, "--from", String(Math.max(0, from))], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }),
);
found.offset = correctOffset(found.offset, boardDelay, encoderDelay(phone));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(found, null, 2) + "\n");
