/**
 * List a song's near-repeat questions: the bars in its chart-style parts
 * that almost repeat a neighbor (see charts/near-repeats.ts), grouped by how
 * much they differ, each with the runs it changes. Reads the built
 * `<slug>.charts.json`, so build the song first.
 *
 * Answer in the chart's manifest entry, then rebuild:
 *   "sameAs": { "13": 9 }   bar 13 is the same as bar 9
 *   "distinct": [13]        bar 13 really is different
 *
 * Usage:
 *   npx tsx src/authoring/chart-questions-cli.ts <song folder>
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ChartsFile } from "../charts/build.js";
import { questionGroup } from "../charts/near-repeats.js";
import { ordinal } from "../manifest.js";

const [dir] = process.argv.slice(2);
if (!dir) {
  console.error("usage: npx tsx src/authoring/chart-questions-cli.ts <song folder>");
  process.exit(1);
}
const name = readdirSync(dir).find((f) => f.endsWith(".charts.json"));
if (!name) {
  console.error(`no .charts.json in ${dir}: build the song first`);
  process.exit(1);
}
const file = JSON.parse(readFileSync(join(dir, name), "utf8")) as ChartsFile;

const sectionName = (i: number) => {
  const s = file.sections[i];
  const many = file.sections.filter((t) => t.name === s.name).length > 1;
  return many ? `${s.name} (${ordinal(s.occurrence)})` : s.name;
};

let total = 0;
for (const chart of file.charts) {
  const qs = chart.questions ?? [];
  if (!qs.length) continue;
  total += qs.length;
  console.log(`${chart.id}: ${qs.length} question(s)`);
  const groups = new Map<string, typeof qs>();
  for (const q of qs) groups.set(questionGroup(q), [...(groups.get(questionGroup(q)) ?? []), q]);
  for (const [group, list] of groups) {
    console.log(`  ${group}:`);
    for (const q of list) {
      console.log(`    bar ${q.scoreBar} is like bar ${q.like} (${q.differ} of ${q.of} beats differ), ${sectionName(q.section)}: ${q.before}  →  ${q.after}`);
    }
  }
}
if (!total) console.log("no near-repeat questions");
else console.log('\nanswer in each chart\'s manifest entry: "sameAs": { "<bar>": <like> } or "distinct": [<bar>]');
