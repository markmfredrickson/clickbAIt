/**
 * Launch clickbAIt: One Simple Track
 *
 * Usage: npx tsx scripts/teleprompter.ts <song-file.ts>
 * Example: npx tsx scripts/teleprompter.ts songs/amy-winehouse/valerie.ts
 */

import { resolve } from "node:path";
import { startTeleprompter } from "../src/teleprompter/index.js";

const songPath = process.argv[2];
if (!songPath) {
  console.error("Usage: npx tsx scripts/teleprompter.ts <song-file.ts>");
  process.exit(1);
}

const songModule = await import(resolve(songPath));
await startTeleprompter({ song: songModule.default });
