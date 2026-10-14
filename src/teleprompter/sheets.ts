/**
 * A song's channels as sheets: one static page per channel, to pass around
 * or print, with everything inlined (the rows, their drawn notation, the
 * music font, the styles and the script), so a page opens from anywhere.
 * The build writes them to `sheets/<slug>.<channel>.html`.
 */

import * as esbuild from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ALPHATAB_DIR } from "./alphatab-files.js";
import { fontDataUri, notationCss } from "../charts/notation-svg.js";
import { clientDir } from "./build-client.js";
import { channelTitle, type RowDocument } from "./rows.js";
import type { CardSong } from "./client/card-view.js";

/** Write every channel's sheet into `dir`; returns the file names. */
export async function writeSheets(doc: RowDocument, song: CardSong, dir: string): Promise<string[]> {
  const script = await esbuild.build({
    entryPoints: [join(clientDir, "sheet.ts")],
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "es2018",
    write: false,
    logLevel: "warning",
  });
  const js = script.outputFiles[0].text;
  const styles = readFileSync(join(clientDir, "style.css"), "utf8");
  const font = notationCss(fontDataUri(new Uint8Array(readFileSync(join(ALPHATAB_DIR, "font/Bravura.woff2")))));

  mkdirSync(dir, { recursive: true });
  return doc.channels.map((channel) => {
    // Each sheet carries only its own channel's notation.
    const own: RowDocument = { ...doc, channels: [channel], notation: doc.notation?.[channel.id] ? { [channel.id]: doc.notation[channel.id] } : undefined };
    const name = `${doc.slug}.${channel.id}.html`;
    writeFileSync(join(dir, name), page(own, song, channel.id, `${doc.title}: ${channelTitle(channel)}`, styles, own.notation ? font : "", js));
    return name;
  });
}

// A closing script tag inside the inlined data would end the script early.
const inline = (s: string) => s.replace(/<\/script/gi, "<\\/script");
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function page(doc: RowDocument, song: CardSong, channel: string, title: string, styles: string, font: string, js: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<style>${styles}</style>
<style>${font}</style>
<style>
#sheet { padding: 1rem; max-width: 1100px; }
#sheet .card { margin-bottom: 1rem; }
#sheet .pane { overflow: visible; font-size: 1.2rem; --notation-zoom: 1.1; }
#sheet .row { color: var(--text); break-inside: avoid; }
.sheet-section { font-size: 0.75rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-dim); margin-top: 0.6rem; break-after: avoid; }
.figure-pass { display: none; }
@media print { body { background: #fff; } #sheet { padding: 0; } }
</style>
</head>
<body class="light">
<div id="sheet"></div>
<script>window.__SHEET__ = ${inline(JSON.stringify({ doc, song, channel }))};</script>
<script>${inline(js)}</script>
</body>
</html>
`;
}
