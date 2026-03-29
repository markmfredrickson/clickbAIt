/**
 * clickbAIt: One Simple Track
 *
 * Entry point: loads a song, starts the OSC→WebSocket relay,
 * prints a QR code to the terminal, and serves the browser client.
 */

import { networkInterfaces } from "node:os";
import { startRelay } from "./relay.js";
import { exportSongPayload } from "./export.js";
import type { Song } from "../types.js";
import QRCode from "qrcode";

export interface TeleprompterOptions {
  song: Song;
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

  const payload = exportSongPayload(opts.song);
  const relay = startRelay({ httpPort, oscPort, song: payload });

  const ip = getLocalIP();
  const url = `http://${ip}:${httpPort}`;

  const qr = await QRCode.toString(url, { type: "terminal", small: true });
  console.log("");
  console.log(`  clickbAIt: One Simple Track — ${payload.title}`);
  console.log(`  ${url}`);
  console.log("");
  console.log(qr);
  console.log(`  OSC listening on UDP port ${oscPort} (REAPER sends /time)`);
  console.log("");
  console.log(`  REAPER setup:`);
  console.log(`    Preferences > Control/OSC/web > Add`);
  console.log(`    Mode: Configure device IP+local port`);
  console.log(`    Device IP: 127.0.0.1 | Device port: ${oscPort}`);
  console.log(`    Pattern config: clickbait`);
  console.log("");

  return relay;
}
