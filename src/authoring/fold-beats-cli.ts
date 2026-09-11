/**
 * Fold a double-tempo beat grid down to the felt tempo.
 *
 * For songs full of 16ths/syncopation, the DBN tracks the EIGHTH grid far more
 * reliably than the quarter grid (it never has to choose between the two
 * eighth lattices, so it can't slip half a beat at a fill — see last-nite).
 * Detect with a doubled BPM window, then fold: keep every other beat. The one
 * musical decision left — which alternate is the beat ("1"s vs "and"s) — is
 * the explicit --phase argument, confirmed by ear or against a validated
 * reference; it is deliberately NOT inferred here (low-band/kick heuristics
 * are confounded by pushed bass bleed in the drum stem).
 *
 *   clickbait-audio beats drums.wav --min-bpm 190 --max-bpm 225 --start 7.8 \
 *     | npx tsx fold-beats-cli.ts - --phase 1 > folded.beats.json
 *
 * Reads a beats.json ({ beats: [{time,strength}], bpm }), writes the same
 * shape with bpm halved and only phase-matching beats kept.
 */

import { readFileSync } from "node:fs";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flag = (name: string): number | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : undefined;
};
const [beatsPath] = args;
const phase = flag("phase");
if (!beatsPath || (phase !== 0 && phase !== 1)) {
  console.error("usage: npx tsx fold-beats-cli.ts <beats.json | -> --phase 0|1");
  process.exit(1);
}

const j = JSON.parse(readFileSync(beatsPath === "-" ? 0 : beatsPath, "utf8"));
const beats = j.beats.filter((_: unknown, i: number) => i % 2 === phase);
process.stdout.write(JSON.stringify({ ...j, bpm: j.bpm / 2, beats }, null, 2) + "\n");
console.error(`folded ${j.beats.length} eighths → ${beats.length} beats (phase ${phase}); bpm ${j.bpm.toFixed(2)} → ${(j.bpm / 2).toFixed(2)}`);
