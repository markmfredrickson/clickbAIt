/**
 * Measure a song's brightness levels through its cut, inside its crop, twice a
 * second (see grade.ts).
 *
 *   npx tsx src/gig/levels-cli.ts <phone video> <out.json> [--in <seconds>] [--out <seconds>]
 *     [--crop <crop as JSON> [--motion <motion.json> --people <people.json>]]
 *
 * Writes `{ rate, samples: [{ t, low, mid, high }] }`, raw: the render smooths them.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { cropFilter } from "./crop-filter.js";
import { levelsOf, type LevelsSample } from "./grade.js";
import { mediaSeconds } from "./media.js";

const RATE = 2;
const [W, H] = [96, 54];

const args = process.argv.slice(2);
const [phone, out] = args;
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!out) {
  console.error("usage: npx tsx src/gig/levels-cli.ts <phone video> <out.json> [--in <seconds>] [--out <seconds>] [--crop <crop as JSON> [--motion <motion.json> --people <people.json>]]");
  process.exit(1);
}
const start = Number(option("--in") ?? 0);
const end = option("--out") !== undefined ? Number(option("--out")) : mediaSeconds(phone);
const crop = option("--crop");
const filters = [
  ...(crop ? [cropFilter(phone, JSON.parse(crop), { start, end }, { motion: option("--motion"), people: option("--people") })] : []),
  `fps=${RATE}`, `scale=${W}:${H}`,
  // The brightness codes as stored, with no range conversion, as `eq` sees them.
  "format=yuv420p", "extractplanes=y",
];
const raw = execFileSync(
  "ffmpeg",
  ["-v", "error", "-ss", String(start), "-to", String(end), "-i", phone, "-vf", filters.join(","), "-f", "rawvideo", "-pix_fmt", "gray", "-"],
  { maxBuffer: 1 << 30 },
);
const samples: LevelsSample[] = [];
for (let k = 0; (k + 1) * W * H <= raw.length; k++) {
  samples.push({ t: +(start + k / RATE).toFixed(3), ...levelsOf(raw.subarray(k * W * H, (k + 1) * W * H)) });
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ rate: RATE, samples }));
console.log(`${out}: ${samples.length} samples`);
