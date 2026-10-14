/**
 * Write a built song's sheets (see sheets.ts) without rebuilding it:
 *
 *   npm run song:sheets -- <song folder>
 *
 * The build writes them too; this is for a song built before it did.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { SongManifestSchema } from "../manifest.js";
import type { RowDocument } from "./rows.js";
import { writeSheets } from "./sheets.js";

const arg = process.argv[2];
if (!arg) {
  console.error("usage: npm run song:sheets -- <song folder>");
  process.exit(1);
}
const dir = resolve(arg);
const files = readdirSync(dir);
const rowsName = files.find((f) => f.endsWith(".rows.json"));
const manifestName = files.find((f) => f.endsWith(".song.json"));
if (!rowsName || !manifestName) {
  console.error(`no *.rows.json or *.song.json in ${dir}: build the song first`);
  process.exit(1);
}
const doc: RowDocument = JSON.parse(readFileSync(join(dir, rowsName), "utf8"));
const manifest = SongManifestSchema.parse(JSON.parse(readFileSync(join(dir, manifestName), "utf8")));
const names = await writeSheets(doc, { title: manifest.title, artist: manifest.artist, key: manifest.key, bpm: manifest.bpm }, join(dir, "sheets"));
console.log(`wrote ${names.map((n) => `sheets/${n}`).join(", ")}`);
