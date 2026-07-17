/**
 * clickbAIt: One Simple Track
 *
 * Entry point: starts the OSC→WebSocket relay with a songs directory.
 * Can optionally start with a specific song pre-loaded.
 */

import { networkInterfaces } from "node:os";
import { readdirSync } from "node:fs";
import { startRelay } from "./relay.js";
import { buildClient } from "./build-client.js";
import { exportSongPayload } from "./export.js";
import type { Song } from "../core/dsongl/index.js";
import QRCode from "qrcode";

export interface TeleprompterOptions {
  /** Pre-load a specific song */
  song?: Song;
  /** Directory containing song JSON files for multi-song mode */
  songsDir?: string;
  /** One or more directories containing song JSON files (takes precedence over songsDir) */
  songsDirs?: string[];
  httpPort?: number;
  oscPort?: number;
}

function getLocalIP(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "localhost";
}

export async function startTeleprompter(opts: TeleprompterOptions) {
  const httpPort = opts.httpPort ?? 3000;
  const oscPort = opts.oscPort ?? 9000;

  // Build the browser client from TS before serving it, so the relay always
  // hands out a client freshly compiled from source (no stale/hand-ported copy).
  await buildClient();

  // Default to 16 beats (4-bar) slug padding so the teleprompter's beat frame
  // matches REAPER's project timeline (which includes the auto-slug region).
  // Matches buildRpp's slugBars minimum.
  const payload = opts.song ? exportSongPayload(opts.song, { minPaddingBeats: 16 }) : undefined;
  const songsDirs = opts.songsDirs && opts.songsDirs.length > 0
    ? opts.songsDirs
    : (opts.songsDir ? [opts.songsDir] : undefined);
  const relay = startRelay({
    httpPort,
    oscPort,
    song: payload,
    songsDirs,
  });

  const ip = getLocalIP();
  const url = `http://${ip}:${httpPort}`;

  const qr = await QRCode.toString(url, { type: "terminal", small: true });
  console.log("");
  console.log(`  clickbAIt: One Simple Track`);
  if (payload) {
    console.log(`  Now playing: ${payload.title}${payload.artist ? ` — ${payload.artist}` : ""}`);
  }
  if (songsDirs && songsDirs.length > 0) {
    console.log(`  Songs dir${songsDirs.length > 1 ? "s" : ""}:`);
    for (const d of songsDirs) console.log(`    ${d}`);
  }
  console.log(`  ${url}`);
  console.log("");
  console.log(qr);
  console.log(`  OSC listening on UDP port ${oscPort}`);

  if (songsDirs && songsDirs.length > 0) {
    const seen = new Set<string>();
    for (const dir of songsDirs) {
      try {
        for (const f of readdirSync(dir)) {
          if (f.endsWith(".json")) seen.add(f.replace(".json", ""));
        }
      } catch { /* dir doesn't exist yet */ }
    }
    console.log(`  Songs available (${seen.size}):`);
    for (const slug of seen) console.log(`    ${slug}`);
  }

  console.log("");

  return relay;
}
