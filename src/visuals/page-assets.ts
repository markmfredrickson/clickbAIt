/** What a scene page loads: the bundled host entry and p5 itself. */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import * as esbuild from "esbuild";

// p5 2.x exports no lib/ path, so find the UMD build from the package entry.
export const P5_MIN = join(dirname(createRequire(import.meta.url).resolve("p5")), "..", "lib", "p5.min.js");

/** Bundle one of this folder's page entries (e.g. "render-page.ts") to an IIFE. */
export async function bundlePage(entry: string): Promise<string> {
  const r = await esbuild.build({
    entryPoints: [join(import.meta.dirname, entry)],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    target: "es2020",
    logLevel: "warning",
  });
  return r.outputFiles[0].text;
}
