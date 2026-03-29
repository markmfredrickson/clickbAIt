/**
 * OSC → WebSocket relay server.
 *
 * Listens for OSC beat position messages from REAPER,
 * broadcasts to all connected browser clients over WebSocket.
 * Also serves the static browser client and song payload.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { createSocket } from "node:dgram";
import { WebSocketServer, type WebSocket } from "ws";
import QRCode from "qrcode";
import { networkInterfaces } from "node:os";
import type { SongPayload } from "./types.js";

export interface RelayOptions {
  /** HTTP/WebSocket port (default 3000) */
  httpPort?: number;
  /** UDP port for incoming OSC messages (default 9000) */
  oscPort?: number;
  /** Song payload to serve to clients */
  song: SongPayload;
  /** Directory containing the static client files */
  clientDir?: string;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

export interface OscMessage { address: string; value: number }

/**
 * Parse a single OSC message with a float arg from a buffer region.
 */
export function parseOscFloat(buf: Buffer, start = 0, end = buf.length): OscMessage | null {
  const nullIdx = buf.indexOf(0, start);
  if (nullIdx < 0 || nullIdx >= end) return null;
  const address = buf.toString("ascii", start, nullIdx);

  let offset = Math.ceil((nullIdx + 1) / 4) * 4;
  const tagNull = buf.indexOf(0, offset);
  if (tagNull < 0 || tagNull >= end) return null;
  const tags = buf.toString("ascii", offset, tagNull);
  if (tags !== ",f") return null;

  offset = Math.ceil((tagNull + 1) / 4) * 4;
  if (offset + 4 > end) return null;
  return { address, value: buf.readFloatBE(offset) };
}

/**
 * Extract all float-typed OSC messages from a packet.
 * Handles both bare messages and OSC bundles (recursive).
 */
export function parseOscPacket(buf: Buffer, start = 0, end = buf.length): OscMessage[] {
  if (buf.toString("ascii", start, start + 7) === "#bundle") {
    // Skip "#bundle\0" (8) + timetag (8) = 16 bytes
    const results: OscMessage[] = [];
    let pos = start + 16;
    while (pos + 4 <= end) {
      const size = buf.readInt32BE(pos);
      pos += 4;
      if (size <= 0 || pos + size > end) break;
      results.push(...parseOscPacket(buf, pos, pos + size));
      pos += size;
    }
    return results;
  }
  const msg = parseOscFloat(buf, start, end);
  return msg ? [msg] : [];
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

/**
 * Convert seconds to beats using the song's tempo map.
 * Inverse of beats→seconds: walks tempo points and computes
 * how many beats fit in the remaining seconds.
 */
export function secondsToBeats(seconds: number, song: SongPayload): number {
  const map = song.tempoMap;
  if (map.length === 0) return (seconds / 60) * song.bpm;

  let beat = 0;
  let prevSec = 0;
  let bpm = map[0].bpm;

  for (const tp of map) {
    if (tp.seconds >= seconds) break;
    if (tp.seconds > prevSec) {
      beat += ((tp.seconds - prevSec) / 60) * bpm;
      prevSec = tp.seconds;
    }
    bpm = tp.bpm;
  }

  beat += ((seconds - prevSec) / 60) * bpm;
  return beat;
}

export function startRelay(opts: RelayOptions) {
  const httpPort = opts.httpPort ?? 3000;
  const oscPort = opts.oscPort ?? 9000;
  const clientDir = opts.clientDir ?? join(import.meta.dirname ?? ".", "client");
  const ip = getLocalIP();
  const baseUrl = `http://${ip}:${httpPort}`;

  // Pre-generate QR code as SVG
  let qrSvgCache: string | null = null;

  // HTTP server — serves static files and song JSON
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";

    if (url === "/song.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(opts.song));
      return;
    }

    if (url === "/" || url === "/join") {
      if (!qrSvgCache) {
        qrSvgCache = await QRCode.toString(baseUrl, { type: "svg" });
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Join — clickbAIt: One Simple Track</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #111; color: #fff; font-family: -apple-system, system-ui, sans-serif;
           display: flex; flex-direction: column; align-items: center; justify-content: center;
           min-height: 100vh; text-align: center; padding: 2rem; }
    h1 { font-size: 2rem; margin-bottom: 0.3rem; }
    .subtitle { color: #888; font-size: 1rem; margin-bottom: 2rem; }
    .qr { width: min(70vw, 400px); height: auto; background: #fff; padding: 1.5rem;
           border-radius: 12px; }
    .qr svg { width: 100%; height: auto; }
    .url { margin-top: 1.5rem; font-size: 1.2rem; font-family: monospace;
           color: #ffcc00; word-break: break-all; }
    .song-title { font-size: 1.5rem; margin-bottom: 0.5rem; color: #ffcc00; }
  </style>
</head>
<body>
  <h1>clickbAIt: One Simple Track</h1>
  <p class="subtitle">Scan to follow along</p>
  <p class="song-title">${opts.song.title}${opts.song.artist ? ` — ${opts.song.artist}` : ""}</p>
  <div class="qr">${qrSvgCache}</div>
  <p class="url">${baseUrl}</p>
  <a href="/lyrics" style="display:inline-block; margin-top:1.5rem; padding:0.8rem 2rem;
     background:#ffcc00; color:#111; text-decoration:none; border-radius:8px;
     font-weight:700; font-size:1.1rem;">Open Lyrics</a>
</body>
</html>`);
      return;
    }

    // Serve static files (/lyrics is the teleprompter view)
    const filePath = url === "/lyrics" ? "index.html" : url.slice(1);
    try {
      const fullPath = join(clientDir, filePath);
      const content = await readFile(fullPath);
      const ext = extname(filePath);
      res.writeHead(200, { "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream" });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  // WebSocket server — attached to same HTTP server
  const wss = new WebSocketServer({ server });
  const clients = new Set<WebSocket>();

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
  });

  function broadcast(message: string) {
    for (const client of clients) {
      if (client.readyState === client.OPEN) {
        client.send(message);
      }
    }
  }

  // OSC UDP listener
  const udp = createSocket("udp4");

  udp.on("message", (msg: Buffer) => {
    const messages = parseOscPacket(msg);
    for (const parsed of messages) {
      if (parsed.address === "/time") {
        const beat = secondsToBeats(parsed.value, opts.song);
        broadcast(JSON.stringify({ type: "position", beat }));
      } else if (parsed.address === "/beat") {
        broadcast(JSON.stringify({ type: "position", beat: parsed.value }));
      } else if (parsed.address === "/play") {
        // REAPER sends /play 1.0 = playing, /play 0.0 = not playing
        broadcast(JSON.stringify({ type: parsed.value > 0.5 ? "play" : "stop" }));
      }
    }
  });

  udp.bind(oscPort);
  server.listen(httpPort);

  return {
    server,
    wss,
    udp,
    close() {
      udp.close();
      wss.close();
      server.close();
    },
  };
}
