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
import { existsSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { runLookup, formatReport } from "./index.js";

// Load .env for GENIUS_API_TOKEN. Walk up from the CWD so a per-song wireit task
// (which runs in songs/<artist>/<slug>/) still finds the repo-root .env, not
// just one in the immediate directory.
function findEnvUpward(): string | undefined {
  let dir = process.cwd();
  const root = parse(dir).root;
  for (;;) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) return candidate;
    if (dir === root) return undefined;
    dir = dirname(dir);
  }
}
config({ path: findEnvUpward(), quiet: true }); // suppress banner

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
