/**
 * Where a phone video starts in the board recording.
 *
 *   npx tsx src/gig/sync-cli.ts <board> <phone video> <out.sync.json>
 *
 * Runs `clickbait-audio offset`, whose decoder leaves each file's encoder delay
 * in, and moves the offset to the files' real timelines (what ffmpeg plays).
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { BIN, encoderDelay } from "./media.js";
import { correctOffset } from "./timeline.js";

const [board, phone, out] = process.argv.slice(2);
if (!out) {
  console.error("usage: npx tsx src/gig/sync-cli.ts <board> <phone video> <out.sync.json>");
  process.exit(1);
}
const found = JSON.parse(execFileSync(BIN, ["offset", board, phone], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }));
found.offset = correctOffset(found.offset, encoderDelay(board), encoderDelay(phone));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(found, null, 2) + "\n");
