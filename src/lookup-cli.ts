/** clickbait-lookup — CLI entry for the TS lookup module.
 *
 *  Replaces the Rust `clickbait-audio lookup` subcommand. Writes the same
 *  line-oriented text report to stdout that the Rust version did, so
 *  existing callers (pipe into a `<slug>.lookup.json` file, read via
 *  scripts/build-dsongl.mjs, etc.) are unaffected.
 *
 *  Usage:
 *    npx clickbait-lookup "<title>" [-a "<artist>"]
 */

import { config } from "dotenv";
import { runLookup, formatReport } from "./lookup/index.js";

config({ quiet: true }); // load .env if present (GENIUS_API_TOKEN); suppress banner

function parseArgs(argv: string[]): { title: string; artist?: string } {
  const args = argv.slice(2);
  let title: string | undefined;
  let artist: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "-a" || args[i] === "--artist") && args[i + 1]) {
      artist = args[++i];
    } else if (!title && !args[i].startsWith("-")) {
      title = args[i];
    }
  }
  if (!title) {
    console.error('usage: npx clickbait-lookup "<title>" [-a "<artist>"]');
    process.exit(1);
  }
  return { title: title!, artist };
}

const { title, artist } = parseArgs(process.argv);

// Progress to stderr so stdout stays clean for piping into a file.
process.stderr.write(`Looking up: "${title}"${artist ? ` by ${artist}` : ""}...\n`);

runLookup(title, artist)
  .then((results) => {
    console.log(formatReport(results));
  })
  .catch((err) => {
    console.error("lookup failed:", err);
    process.exit(1);
  });
