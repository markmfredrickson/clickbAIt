/**
 * double-time — rewrite a half-time score at the band's tempo, as a Guitar Pro file.
 *
 *   npx tsx src/charts/double-time-cli.ts <score> <out.gp>
 *
 * Reads any score alphaTab reads (Guitar Pro 3–7, MusicXML, alphaTex) and
 * writes a Guitar Pro 7 file with every bar doubled (see double-time.ts). The
 * output is derived: point the manifest's `scores[].file` at it and make it
 * with a wireit task in the song's recipe.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { loadScore } from "./score-info.js";
import { doubleTime, toGuitarPro } from "./double-time.js";

const [input, output] = process.argv.slice(2);
if (!input || !output || !output.endsWith(".gp")) {
  console.error("usage: double-time-cli <score> <out.gp>");
  process.exit(1);
}

const score = loadScore(new Uint8Array(readFileSync(input)), basename(input));
const before = score.masterBars.length;
const doubled = doubleTime(score);
writeFileSync(output, toGuitarPro(doubled));
console.log(`${basename(output)}: ${before} bars → ${doubled.masterBars.length}, tempo ${score.tempo} → ${doubled.tempo}`);
