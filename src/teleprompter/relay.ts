/**
 * OSC → WebSocket relay server.
 *
 * Listens for OSC messages from REAPER, broadcasts to browser clients.
 * Supports multiple songs via a songs directory — switches automatically
 * when REAPER sends a region name matching a song slug.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { createSocket } from "node:dgram";
import { WebSocketServer, type WebSocket } from "ws";
import QRCode from "qrcode";
import { networkInterfaces } from "node:os";
import type { SongPayload } from "./types.js";
import { toSlug } from "./export.js";

export interface RelayOptions {
  /** HTTP/WebSocket port (default 3000) */
  httpPort?: number;
  /** UDP port for incoming OSC messages (default 9000) */
  oscPort?: number;
  /** Directory containing song JSON files (default: cwd) */
  songsDir?: string;
  /** Initial song payload (optional — can also load from songsDir) */
  song?: SongPayload;
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

// ── OSC parsing ──

export interface OscFloat { type: "float"; address: string; value: number }
export interface OscString { type: "string"; address: string; value: string }
export type OscMessage = OscFloat | OscString;

/**
 * Parse a single OSC message (float or string arg) from a buffer region.
 */
export function parseOscMessage(buf: Buffer, start = 0, end = buf.length): OscMessage | null {
  const nullIdx = buf.indexOf(0, start);
  if (nullIdx < 0 || nullIdx >= end) return null;
  const address = buf.toString("ascii", start, nullIdx);

  let offset = Math.ceil((nullIdx + 1) / 4) * 4;
  const tagNull = buf.indexOf(0, offset);
  if (tagNull < 0 || tagNull >= end) return null;
  const tags = buf.toString("ascii", offset, tagNull);

  offset = Math.ceil((tagNull + 1) / 4) * 4;

  if (tags === ",f") {
    if (offset + 4 > end) return null;
    return { type: "float", address, value: buf.readFloatBE(offset) };
  }

  if (tags === ",s") {
    const sNull = buf.indexOf(0, offset);
    if (sNull < 0) return null;
    return { type: "string", address, value: buf.toString("utf8", offset, sNull) };
  }

  return null;
}

/** Backwards compat alias */
export function parseOscFloat(buf: Buffer, start = 0, end = buf.length): OscFloat | null {
  const msg = parseOscMessage(buf, start, end);
  return msg?.type === "float" ? msg : null;
}

/**
 * Extract all OSC messages from a packet (handles bundles).
 */
export function parseOscPacket(buf: Buffer, start = 0, end = buf.length): OscMessage[] {
  if (buf.toString("ascii", start, start + 7) === "#bundle") {
    const results: OscMessage[] = [];
    let pos = start + 16; // skip header + timetag
    while (pos + 4 <= end) {
      const size = buf.readInt32BE(pos);
      pos += 4;
      if (size <= 0 || pos + size > end) break;
      results.push(...parseOscPacket(buf, pos, pos + size));
      pos += size;
    }
    return results;
  }
  const msg = parseOscMessage(buf, start, end);
  return msg ? [msg] : [];
}

// ── Utilities ──

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

// ── Server ──

export function startRelay(opts: RelayOptions) {
  const httpPort = opts.httpPort ?? 3000;
  const oscPort = opts.oscPort ?? 9000;
  const clientDir = opts.clientDir ?? join(import.meta.dirname ?? ".", "client");
  const songsDir = opts.songsDir ?? process.cwd();
  const ip = getLocalIP();
  const baseUrl = `http://${ip}:${httpPort}`;

  // Current song state
  let currentSong: SongPayload | null = opts.song ?? null;
  let currentSlug = currentSong?.slug ?? "";

  // Song cache: slug → payload
  const songCache = new Map<string, SongPayload>();
  if (currentSong) songCache.set(currentSlug, currentSong);

  async function loadSong(slug: string): Promise<SongPayload | null> {
    if (songCache.has(slug)) return songCache.get(slug)!;
    try {
      const data = await readFile(join(songsDir, slug + ".json"), "utf8");
      const payload = JSON.parse(data) as SongPayload;
      songCache.set(slug, payload);
      return payload;
    } catch {
      return null;
    }
  }

  async function switchSong(slug: string) {
    if (slug === currentSlug) return;
    const song = await loadSong(slug);
    if (!song) {
      console.log(`  Song not found: ${slug}.json`);
      return;
    }
    currentSong = song;
    currentSlug = slug;
    qrSvgCache = null; // reset QR (song title changed)
    console.log(`  Switched to: ${song.title}${song.artist ? ` — ${song.artist}` : ""}`);
    broadcast(JSON.stringify({ type: "song-changed", slug }));
  }

  // Pre-generate QR code as SVG
  let qrSvgCache: string | null = null;

  // HTTP server
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";

    if (url === "/song.json") {
      if (!currentSong) {
        res.writeHead(404);
        res.end("No song loaded");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(currentSong));
      return;
    }

    if (url === "/" || url === "/join") {
      if (!qrSvgCache) {
        qrSvgCache = await QRCode.toString(baseUrl, { type: "svg" });
      }
      const songLine = currentSong
        ? `${currentSong.title}${currentSong.artist ? ` — ${currentSong.artist}` : ""}`
        : "Waiting for song…";
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
  <p class="song-title">${songLine}</p>
  <div class="qr">${qrSvgCache}</div>
  <p class="url">${baseUrl}</p>
  <a href="/lyrics" style="display:inline-block; margin-top:1.5rem; padding:0.8rem 2rem;
     background:#ffcc00; color:#111; text-decoration:none; border-radius:8px;
     font-weight:700; font-size:1.1rem;">Open Lyrics</a>
</body>
</html>`);
      return;
    }

    // List available songs
    if (url === "/songs") {
      try {
        const files = await readdir(songsDir);
        const songs = files.filter(f => f.endsWith(".json")).map(f => f.replace(".json", ""));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(songs));
      } catch {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("[]");
      }
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

  // WebSocket
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
      if (parsed.type === "float") {
        if (parsed.address === "/time" && currentSong) {
          const beat = secondsToBeats(parsed.value, currentSong);
          broadcast(JSON.stringify({ type: "position", beat }));
        } else if (parsed.address === "/beat") {
          broadcast(JSON.stringify({ type: "position", beat: parsed.value }));
        } else if (parsed.address === "/play") {
          broadcast(JSON.stringify({ type: parsed.value > 0.5 ? "play" : "stop" }));
        }
      } else if (parsed.type === "string") {
        if (parsed.address === "/lastregion/name" && parsed.value) {
          const slug = toSlug(parsed.value);
          if (slug) switchSong(slug);
        }
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
