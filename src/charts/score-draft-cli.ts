/**
 * score-draft — print a first draft of a song's sections from a score.
 *
 *   npx tsx src/charts/score-draft-cli.ts <manifest.song.json> <score.gp5>
 *
 * Section names come from the manifest's current sections (a first-cut
 * manifest carries the lyric sections), and the bar-count check uses the
 * recording's detected beats beside it. Prints only: it never writes the
 * manifest.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { loadScore, scoreLayout } from "./score-info.js";
import { draftSections } from "./score-draft.js";

const [manifestPath, scorePath] = process.argv.slice(2);
if (!manifestPath || !scorePath) {
  console.error("usage: score-draft-cli <manifest.song.json> <score file>");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const beatsPath = join(dirname(manifestPath), `${manifest.sources.recording.file}.beats.json`);
const detectedBeats = existsSync(beatsPath)
  ? (JSON.parse(readFileSync(beatsPath, "utf8")).beats as unknown[]).length
  : undefined;

const score = loadScore(new Uint8Array(readFileSync(scorePath)), basename(scorePath));
const draft = draftSections(scoreLayout(score), {
  lyricSections: manifest.sections.map((s: { name: string }) => s.name),
  detectedBeats,
});

const total = draft.sections.reduce((n, s) => n + s.bars, 0);
console.log(`${basename(scorePath)}: ${total} bars in ${draft.timeSignature.join("/")}, ${draft.countInBars} count-in bar(s) dropped`);
for (const s of draft.sections) {
  const meter = s.timeSignature ? `  (${s.timeSignature.join("/")})` : "";
  console.log(`  ${s.name.padEnd(24)} ${String(s.bars).padStart(3)} bars  score ${s.scoreBars[0]}–${s.scoreBars[1]}${meter}`);
}
if (draft.decisions.length) {
  console.log("decisions:");
  for (const d of draft.decisions) console.log(`  - ${d}`);
}
