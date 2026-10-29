/**
 * Launch clickbAIt: One Simple Track
 *
 * Usage:
 *   npx tsx scripts/teleprompter.ts <song-file.ts>                    # single song
 *   npx tsx scripts/teleprompter.ts --songs-dir ./dir                  # multi-song
 *   npx tsx scripts/teleprompter.ts --songs-dir ./a --songs-dir ./b    # multiple dirs
 *   npx tsx scripts/teleprompter.ts <song.ts> --songs-dir ./dir        # both
 *   npx tsx scripts/teleprompter.ts                                    # the songs and set list in .clickbait.json
 *   npx tsx scripts/teleprompter.ts --songs-dir ./a --setlist set.txt  # named songs, in a set list's order
 */

import { resolve } from "node:path";
import { relaySongs } from "../src/teleprompter/catalog.js";
import { startTeleprompter } from "../src/teleprompter/index.js";

const args = process.argv.slice(2);
let songPath: string | undefined;
const songsDirs: string[] = [];
let setlistFile: string | undefined;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--songs-dir" && args[i + 1]) {
    songsDirs.push(resolve(args[++i]));
  } else if (args[i] === "--setlist" && args[i + 1]) {
    setlistFile = resolve(args[++i]);
  } else if (!args[i].startsWith("-")) {
    songPath = args[i];
  }
}

let setlist: string[] | undefined;
if (!songPath) {
  try {
    const found = relaySongs(songsDirs, process.cwd(), setlistFile);
    songsDirs.splice(0, songsDirs.length, ...found.songsDirs);
    setlist = found.setlist;
    if (found.unbuilt.length) console.error(`not built yet (skipped): ${found.unbuilt.join(", ")}`);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}

const song = songPath
  ? (await import(resolve(songPath))).default
  : undefined;

await startTeleprompter({ song, songsDirs, setlist });
