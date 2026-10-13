/**
 * transpose-score — write a score in the key the band plays, as a Guitar Pro file.
 *
 *   npx tsx src/charts/transpose-cli.ts <score> <out.gp> --manifest <song.json>
 *   npx tsx src/charts/transpose-cli.ts <score> <out.gp> --steps -4
 *
 * With --manifest the steps come from its `transpose` (a key pair or steps),
 * so the score follows the song. Reads any score alphaTab reads and writes a
 * Guitar Pro 7 file, re-fretted to stay playable (see transpose-score.ts). The
 * output is derived: point the manifest's `scores[].file` at it and make it
 * with a wireit task in the song's recipe.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { loadScore } from "./score-info.js";
import { toGuitarPro } from "./double-time.js";
import { transposeScore } from "./transpose-score.js";
import { transposeSteps } from "../build/transpose.js";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const [input, output] = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const manifest = flag("manifest");
const stepsArg = flag("steps");
if (!input || !output || !output.endsWith(".gp") || (!manifest && stepsArg === undefined)) {
  console.error("usage: transpose-cli <score> <out.gp> (--manifest <song.json> | --steps <n>)");
  process.exit(1);
}

let steps: number;
if (manifest) {
  const transpose = JSON.parse(readFileSync(manifest, "utf8")).transpose;
  if (transpose === undefined) {
    console.error(`${manifest} has no transpose`);
    process.exit(1);
  }
  steps = transposeSteps(transpose);
} else {
  steps = Number(stepsArg);
}

const score = transposeScore(loadScore(new Uint8Array(readFileSync(input)), basename(input)), steps);
writeFileSync(output, toGuitarPro(score));
console.log(`${basename(output)}: ${steps > 0 ? "+" : ""}${steps} semitones`);
