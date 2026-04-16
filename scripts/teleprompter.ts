/**
 * Launch clickbAIt: One Simple Track
 *
 * Usage:
 *   npx tsx scripts/teleprompter.ts <song-file.ts>                    # single song
 *   npx tsx scripts/teleprompter.ts --songs-dir ./dir                  # multi-song
 *   npx tsx scripts/teleprompter.ts --songs-dir ./a --songs-dir ./b    # multiple dirs
 *   npx tsx scripts/teleprompter.ts <song.ts> --songs-dir ./dir        # both
 */

import { resolve } from "node:path";
import { startTeleprompter } from "../src/teleprompter/index.js";

const args = process.argv.slice(2);
let songPath: string | undefined;
const songsDirs: string[] = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--songs-dir" && args[i + 1]) {
    songsDirs.push(resolve(args[++i]));
  } else if (!args[i].startsWith("-")) {
    songPath = args[i];
  }
}

if (!songPath && songsDirs.length === 0) {
  console.error("Usage:");
  console.error("  npx tsx scripts/teleprompter.ts <song-file.ts>");
  console.error("  npx tsx scripts/teleprompter.ts --songs-dir ./output/songs");
  console.error("  npx tsx scripts/teleprompter.ts --songs-dir ./a --songs-dir ./b");
  process.exit(1);
}

const song = songPath
  ? (await import(resolve(songPath))).default
  : undefined;

await startTeleprompter({ song, songsDirs });
