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

/**
 * Parse a raw OSC message buffer.
 * We only care about messages like: /beat f <float>
 * OSC format: null-terminated address string, padded to 4-byte boundary,
 * null-terminated type tag string (e.g. ",f"), padded, then args.
 */
export function parseOscFloat(buf: Buffer): { address: string; value: number } | null {
  // Read null-terminated address
  const nullIdx = buf.indexOf(0);
  if (nullIdx === -1) return null;
  const address = buf.toString("ascii", 0, nullIdx);

  // Skip to next 4-byte boundary
  let offset = Math.ceil((nullIdx + 1) / 4) * 4;

  // Read type tag string (should start with ',')
  const tagNull = buf.indexOf(0, offset);
  if (tagNull === -1) return null;
  const tags = buf.toString("ascii", offset, tagNull);
  if (tags !== ",f") return null;

  // Skip to next 4-byte boundary
  offset = Math.ceil((tagNull + 1) / 4) * 4;

  // Read 32-bit float (big-endian)
  if (offset + 4 > buf.length) return null;
  const value = buf.readFloatBE(offset);
  return { address, value };
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
    const parsed = parseOscFloat(msg);
    if (!parsed) return;

    if (parsed.address === "/beat") {
      broadcast(JSON.stringify({ type: "position", beat: parsed.value }));
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
