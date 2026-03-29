/**
 * clickbAIt: One Simple Track
 *
 * Entry point: starts the OSC→WebSocket relay with a songs directory.
 * Can optionally start with a specific song pre-loaded.
 */

import { networkInterfaces } from "node:os";
import { startRelay } from "./relay.js";
import { exportSongPayload } from "./export.js";
import type { Song } from "../types.js";
import QRCode from "qrcode";

export interface TeleprompterOptions {
  /** Pre-load a specific song */
  song?: Song;
  /** Directory containing song JSON files for multi-song mode */
  songsDir?: string;
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

  const payload = opts.song ? exportSongPayload(opts.song) : undefined;
  const relay = startRelay({
    httpPort,
    oscPort,
    song: payload,
    songsDir: opts.songsDir,
  });

  const ip = getLocalIP();
  const url = `http://${ip}:${httpPort}`;

  const qr = await QRCode.toString(url, { type: "terminal", small: true });
  console.log("");
  console.log(`  clickbAIt: One Simple Track`);
  if (payload) {
    console.log(`  Now playing: ${payload.title}${payload.artist ? ` — ${payload.artist}` : ""}`);
  }
  if (opts.songsDir) {
    console.log(`  Songs dir: ${opts.songsDir}`);
  }
  console.log(`  ${url}`);
  console.log("");
  console.log(qr);
  console.log(`  OSC listening on UDP port ${oscPort} (REAPER sends /time)`);
  console.log(`  Song switching via /lastregion/name`);
  console.log("");

  return relay;
}
