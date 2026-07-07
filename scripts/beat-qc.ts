/**
 * Beat-grid QC CLI (flag-only). Reports inter-beat intervals that stretch more
 * than a threshold off the song's constant tempo — likely detection errors.
 *
 *   npx tsx scripts/beat-qc.ts <beats.json> [--threshold 0.05] [--bpm N]
 *                                            [--anchor SEC] [--all]
 *
 * Default output: the flag count + the flagged intervals. `--all` prints the
 * full signed relChange series (the "go back later" record). Never edits input.
 */
import { readFileSync } from "node:fs";
import { analyzeBeatStretches } from "../src/authoring/beat-qc.js";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const num = (flag: string): number | undefined => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : undefined;
};
const showAll = args.includes("--all");

if (!file) {
  console.error("usage: npx tsx scripts/beat-qc.ts <beats.json> [--threshold 0.05] [--bpm N] [--anchor SEC] [--all]");
  process.exit(1);
}

const doc = JSON.parse(readFileSync(file, "utf8"));
const beats = doc.beats ?? doc;
const r = analyzeBeatStretches(beats, {
  threshold: num("--threshold"),
  bpm: num("--bpm"),
  anchor: num("--anchor"),
});

const pct = (x: number) => `${(x * 100 >= 0 ? "+" : "")}${(x * 100).toFixed(1)}%`;
const where = (iv: { bar?: number; time: number }) =>
  iv.bar !== undefined ? `bar ${iv.bar} (${iv.time.toFixed(2)}s)` : `${iv.time.toFixed(2)}s`;

console.log(
  `grid: ${beats.length} beats, ref ${r.bpm.toFixed(2)} BPM (${r.reference}), threshold ${pct(r.threshold)}`,
);
console.log(`FLAGS: ${r.flagCount} interval(s) > ${pct(r.threshold)}`);

if (showAll) {
  for (const iv of r.intervals) console.log(`  ${where(iv).padEnd(22)} ${pct(iv.relChange)}`);
} else {
  for (const iv of r.flags) console.log(`  ⚠ ${where(iv).padEnd(22)} ${pct(iv.relChange)}`);
}

process.exit(r.flagCount > 0 ? 2 : 0);
