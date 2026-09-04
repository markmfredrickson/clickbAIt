/**
 * Prepend evidence-based intro pins to a detected beats.json (see
 * intro-pins.ts). Reads the detected grid and the full-mix analysis onsets,
 * writes the merged beats JSON to stdout — composed in a song recipe as:
 *
 *   clickbait-audio beats stems/source_drums.wav --start <drum entry> > detected.json \
 *     && npx tsx .../intro-pins-cli.ts detected.json source.m4a.analysis.json > source.m4a.beats.json
 *
 * Prints the pin count to stderr with the startBeat reminder: first detected
 * beat at song beat B + N prepended pins → manifest startBeat = B - N.
 */

import { readFileSync } from "node:fs";
import { chainIntroPins } from "./intro-pins.js";

const [beatsPath, analysisPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flag = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : undefined;
};
if (!beatsPath || !analysisPath) {
  console.error("usage: npx tsx intro-pins-cli.ts <detected.beats.json> <analysis.json> [--tolerance s] [--min-strength x]");
  process.exit(1);
}

const beatsJson = JSON.parse(readFileSync(beatsPath, "utf8"));
const analysis = JSON.parse(readFileSync(analysisPath, "utf8"));
const pins = chainIntroPins(beatsJson.beats, analysis.onsets, {
  ...(flag("tolerance") !== undefined ? { tolerance: flag("tolerance") } : {}),
  ...(flag("min-strength") !== undefined ? { minStrength: flag("min-strength") } : {}),
});

process.stdout.write(
  JSON.stringify({ ...beatsJson, beats: [...pins, ...beatsJson.beats] }, null, 2) + "\n",
);
console.error(
  `prepended ${pins.length} intro pin(s)` +
    (pins.length ? ` (${pins[0].time.toFixed(3)}s → ${pins.at(-1)!.time.toFixed(3)}s); manifest startBeat = <first detected beat's song beat> - ${pins.length}` : ""),
);
