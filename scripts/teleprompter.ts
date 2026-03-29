/**
 * Launch clickbAIt: One Simple Track
 *
 * Usage:
 *   npx tsx scripts/teleprompter.ts <song-file.ts>              # single song
 *   npx tsx scripts/teleprompter.ts --songs-dir ./output/songs   # multi-song
 *   npx tsx scripts/teleprompter.ts <song.ts> --songs-dir ./dir  # both
 */

import { resolve } from "node:path";
import { startTeleprompter } from "../src/teleprompter/index.js";

const args = process.argv.slice(2);
let songPath: string | undefined;
let songsDir: string | undefined;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--songs-dir" && args[i + 1]) {
    songsDir = resolve(args[++i]);
  } else if (!args[i].startsWith("-")) {
    songPath = args[i];
  }
}

if (!songPath && !songsDir) {
  console.error("Usage:");
  console.error("  npx tsx scripts/teleprompter.ts <song-file.ts>");
  console.error("  npx tsx scripts/teleprompter.ts --songs-dir ./output/songs");
  process.exit(1);
}

const song = songPath
  ? (await import(resolve(songPath))).default
  : undefined;

await startTeleprompter({ song, songsDir });
