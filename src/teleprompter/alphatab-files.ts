/**
 * The music font alphaTab draws notation in (Bravura). Notation is drawn at
 * build (charts/notation-svg.ts), so displays need only the font: the relay
 * serves it, and only it, from the installed package, and the e-ink
 * renderer serves the same file to headless Chrome.
 */

import { createRequire } from "node:module";
import { dirname } from "node:path";

export const ALPHATAB_DIR = dirname(createRequire(import.meta.url).resolve("@coderline/alphatab"));

/** File name (under ALPHATAB_DIR) → content type. */
export const ALPHATAB_FILES: Record<string, string> = {
  "font/Bravura.woff2": "font/woff2",
};

/** Where a display loads the font from. */
export const FONT = "/vendor/alphatab/font/Bravura.woff2";
