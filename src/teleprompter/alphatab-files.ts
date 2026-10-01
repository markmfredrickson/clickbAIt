/**
 * alphaTab draws notation in the browser. The relay serves its script and
 * the Bravura music font, and only those files, from the installed package;
 * the e-ink renderer serves the same files to headless Chrome.
 */

import { createRequire } from "node:module";
import { dirname } from "node:path";

export const ALPHATAB_DIR = dirname(createRequire(import.meta.url).resolve("@coderline/alphatab"));

/** File name (under ALPHATAB_DIR) → content type. */
export const ALPHATAB_FILES: Record<string, string> = {
  "alphaTab.min.js": "application/javascript",
  "font/Bravura.woff2": "font/woff2",
  "font/Bravura.woff": "font/woff",
  "font/Bravura.otf": "font/otf",
  "font/Bravura.svg": "image/svg+xml",
  "font/Bravura.eot": "application/vnd.ms-fontobject",
};
