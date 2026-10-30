/**
 * The people in a song's video (see people.swift), twice a second over its cut.
 *
 *   npx tsx src/gig/people-cli.ts <phone video> <out.json> [--in <seconds>] [--out <seconds>]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { mediaSeconds } from "./media.js";
import { findPeople } from "./people.js";

const RATE = 2;
const args = process.argv.slice(2);
const [phone, out] = args;
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : undefined;
};
if (!out) {
  console.error("usage: npx tsx src/gig/people-cli.ts <phone video> <out.json> [--in <seconds>] [--out <seconds>]");
  process.exit(1);
}
const start = option("--in") ?? 0;
const end = option("--out") ?? mediaSeconds(phone);
const samples = findPeople(phone, start, end, RATE);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ rate: RATE, samples }) + "\n");
