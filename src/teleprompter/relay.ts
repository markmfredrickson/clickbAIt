/**
 * OSC → WebSocket relay server.
 *
 * Listens for OSC messages from REAPER, broadcasts to browser clients.
 * Supports multiple songs via a songs directory — switches automatically
 * when REAPER sends a region name matching a song slug.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { createSocket } from "node:dgram";
import { WebSocketServer, type WebSocket } from "ws";
import QRCode from "qrcode";
import { networkInterfaces } from "node:os";
import type { SongPayload, TempoPoint } from "./types.js";
import type { LyricsDisplay, MeterSegment } from "./lyrics-display.js";
import { toSlug } from "../core/dsongl/index.js";
import { Curve, type Anchor } from "../core/curve.js";

/** Either song format the relay can serve. */
type LoadedSong = SongPayload | LyricsDisplay;
/** The fields the seconds→beats conversion needs from either format. */
type TimingSong = { bpm: number; tempoMap?: TempoPoint[]; curve?: Anchor[] };

export interface RelayOptions {
  /** HTTP/WebSocket port (default 3000) */
  httpPort?: number;
  /** UDP port for incoming OSC messages (default 9000) */
  oscPort?: number;
  /** Directories containing song JSON files (default: [cwd]). Searched in order; first match wins. */
  songsDirs?: string[];
  /** Initial song payload (optional — can also load from songsDir) */
  song?: LoadedSong;
  /** Directory containing the static client files */
  clientDir?: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]!));
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
 * Convert seconds to beats through the song's curve. Handles both formats: a
 * LyricsDisplay carries explicit `(t,b)` curve anchors; a legacy SongPayload
 * carries a piecewise `tempoMap`. Cached per song — `/time` OSC messages arrive
 * at high frequency, so rebuilding the curve each call would be wasteful.
 */
const curveCache = new WeakMap<object, Curve>();

export function secondsToBeats(seconds: number, song: TimingSong): number {
  let curve = curveCache.get(song);
  if (!curve) {
    if (song.curve && song.curve.length >= 2) curve = new Curve(song.curve);
    else if (song.tempoMap && song.tempoMap.length > 0) curve = Curve.fromTempoMap(song.tempoMap);
    else return (seconds / 60) * song.bpm;
    curveCache.set(song, curve);
  }
  return curve.toBeat(seconds);
}

/** True when the loaded song is a LyricsDisplay (drives REAPER `/beat/str` use). */
function isLyricsDisplay(song: LoadedSong): song is LyricsDisplay {
  return "schema" in song && song.schema === "clickbait/lyrics-display@1";
}

/**
 * Parse REAPER's `/beat/str` ("measure.beat.hundredths", PROJOFFS-aware so the
 * downbeat is measure 1 and the count-in is negative measures) into a
 * continuous downbeat-relative beat: downbeat = 0, count-in negative.
 *
 * `meter` is either a constant beats-per-bar, or a MeterSegment list for songs
 * with a meter change (a 2/4 pickup, say). With a constant, a 2/4 bar would
 * make every later measure overcount by 2 beats — the segments fix that by
 * counting each measure in its own meter.
 */
export function beatStrToBeats(
  beatStr: string,
  meter: number | MeterSegment[],
): number {
  const parts = beatStr.split(".");
  const measure = parseInt(parts[0], 10);
  const beat = parseInt(parts[1] ?? "1", 10);
  const hundredths = parts[2] ? parseInt(parts[2], 10) : 0;
  const frac = (beat - 1) + hundredths / 100;

  if (typeof meter === "number") {
    return (measure - 1) * meter + frac;
  }
  // Find the last segment starting at or before this measure. Measures before
  // the first segment (count-in) use the first segment's meter.
  let seg = meter[0];
  for (const s of meter) {
    if (s.fromMeasure <= measure) seg = s;
    else break;
  }
  return seg.beatsBefore + (measure - seg.fromMeasure) * seg.beatsPerBar + frac;
}

// ── Server ──

export function startRelay(opts: RelayOptions) {
  const httpPort = opts.httpPort ?? 3000;
  const oscPort = opts.oscPort ?? 9000;
  const clientDir = opts.clientDir ?? join(import.meta.dirname ?? ".", "client");
  const songsDirs = opts.songsDirs && opts.songsDirs.length > 0 ? opts.songsDirs : [process.cwd()];
  const ip = getLocalIP();
  const baseUrl = `http://${ip}:${httpPort}`;

  // Current song state
  let currentSong: LoadedSong | null = opts.song ?? null;
  let currentSlug = currentSong?.slug ?? "";

  // Song cache: slug → {payload, filePath, mtimeMs}
  interface CacheEntry { payload: LoadedSong; filePath: string; mtimeMs: number }
  const songCache = new Map<string, CacheEntry>();
  let currentCacheEntry: CacheEntry | null = null;
  if (currentSong) {
    currentCacheEntry = { payload: currentSong, filePath: "", mtimeMs: 0 };
    songCache.set(currentSlug, currentCacheEntry);
  }

  /** Load song by slug, returning a cache entry. Re-reads from disk if the
   *  file's mtime is newer than the cached copy. */
  async function loadSong(slug: string): Promise<CacheEntry | null> {
    // Find the file on disk (first matching dir wins)
    let filePath: string | null = null;
    let mtimeMs = 0;
    // Prefer the new LyricsDisplay build; fall back to the legacy SongPayload.
    const names = [slug + ".lyrics-display.json", slug + ".json"];
    outer: for (const dir of songsDirs) {
      for (const name of names) {
        const candidate = join(dir, name);
        try {
          const s = await stat(candidate);
          filePath = candidate;
          mtimeMs = s.mtimeMs;
          break outer;
        } catch { /* try next */ }
      }
    }
    if (!filePath) {
      // Not on disk. Return any stale cache entry (e.g. in-memory only) if present.
      return songCache.get(slug) ?? null;
    }

    const cached = songCache.get(slug);
    if (cached && cached.filePath === filePath && cached.mtimeMs >= mtimeMs) {
      return cached;
    }

    try {
      const data = await readFile(filePath, "utf8");
      const payload = JSON.parse(data) as LoadedSong;
      const entry = { payload, filePath, mtimeMs };
      songCache.set(slug, entry);
      return entry;
    } catch {
      return cached ?? null;
    }
  }

  async function switchSong(slug: string) {
    if (slug === currentSlug) return;
    const entry = await loadSong(slug);
    if (!entry) return; // not a song slug — just a section name, ignore silently
    currentSong = entry.payload;
    currentSlug = slug;
    currentCacheEntry = entry;
    qrSvgCache = null; // reset QR (song title changed)
    console.log(`  Switched to: ${entry.payload.title}${entry.payload.artist ? ` — ${entry.payload.artist}` : ""}`);
    broadcast(JSON.stringify({ type: "song-changed", slug }));
  }

  /** Poll the currently loaded song's file for mtime changes. If the file was
   *  regenerated, reload and tell connected browsers to refresh. */
  const pollIntervalMs = 2000;
  const pollTimer = setInterval(async () => {
    if (!currentCacheEntry || !currentCacheEntry.filePath) return;
    try {
      const s = await stat(currentCacheEntry.filePath);
      if (s.mtimeMs > currentCacheEntry.mtimeMs) {
        songCache.delete(currentSlug);
        const entry = await loadSong(currentSlug);
        if (entry) {
          currentSong = entry.payload;
          currentCacheEntry = entry;
          console.log(`  Reloaded (file changed): ${entry.payload.title}`);
          broadcast(JSON.stringify({ type: "song-changed", slug: currentSlug }));
        }
      }
    } catch { /* file gone or unreadable — ignore */ }
  }, pollIntervalMs);
  pollTimer.unref();

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
        ? `${escapeHtml(currentSong.title)}${currentSong.artist ? ` — ${escapeHtml(currentSong.artist)}` : ""}`
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
    .song-title { font-size: 1.5rem; margin-bottom: 0.5rem; color: #ffcc00;
                   transition: text-shadow 0.5s ease; }
    .song-title.glow { text-shadow: 0 0 20px #ffcc00, 0 0 40px #ffcc00; }
  </style>
</head>
<body>
  <h1>clickbAIt: One Simple Track</h1>
  <p class="subtitle">Scan to follow along</p>
  <p class="song-title" id="song-title">${songLine}</p>
  <div class="qr">${qrSvgCache}</div>
  <p class="url">${baseUrl}</p>
  <a href="/lyrics" style="display:inline-block; margin-top:1.5rem; padding:0.8rem 2rem;
     background:#ffcc00; color:#111; text-decoration:none; border-radius:8px;
     font-weight:700; font-size:1.1rem;">Open Lyrics</a>
  <script>
    (function() {
      var el = document.getElementById("song-title");
      var ws = new WebSocket((location.protocol === "https:" ? "wss:" : "ws:") + "//" + location.host);
      ws.onmessage = function(e) {
        var msg;
        try { msg = JSON.parse(e.data); } catch(x) { return; }
        if (msg.type === "song-changed") {
          fetch("/song.json").then(function(r) { return r.json(); }).then(function(song) {
            var text = song.title;
            if (song.artist) text += " — " + song.artist;
            el.textContent = text;
            el.classList.add("glow");
            setTimeout(function() { el.classList.remove("glow"); }, 2000);
          });
        }
      };
      // Poll on load in case song loaded before page opened
      fetch("/song.json").then(function(r) {
        if (!r.ok) return;
        return r.json();
      }).then(function(song) {
        if (!song) return;
        var text = song.title;
        if (song.artist) text += " — " + song.artist;
        el.textContent = text;
      });
    })();
  </script>
</body>
</html>`);
      return;
    }

    // List available songs (merged across all songsDirs, first dir wins on slug collision)
    if (url === "/songs") {
      const seen = new Set<string>();
      for (const dir of songsDirs) {
        try {
          const files = await readdir(dir);
          for (const f of files) {
            if (f.endsWith(".json")) seen.add(f.replace(".json", ""));
          }
        } catch { /* dir missing — skip */ }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([...seen]));
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
    // Send current state immediately so new clients don't have to wait
    // for the next OSC event
    if (currentSong) {
      ws.send(JSON.stringify({ type: "song-changed", slug: currentSlug }));
    }
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
  let playing = false;
  let lastBeatLog = -1;

  udp.on("message", (msg: Buffer) => {
    const messages = parseOscPacket(msg);
    for (const parsed of messages) {
      if (parsed.type === "float") {
        // Legacy SongPayload: derive beat from /time through the tempo map.
        // LyricsDisplay uses REAPER's /beat/str instead (handled below), which
        // is PROJOFFS-aware and stays correct at any tempo/playrate.
        if (parsed.address === "/time" && currentSong && !isLyricsDisplay(currentSong)) {
          const beat = secondsToBeats(parsed.value, currentSong);
          broadcast(JSON.stringify({ type: "position", beat }));
          // Log beat progress as a spinner (update every ~4 beats)
          const rounded = Math.floor(beat / 4) * 4;
          if (rounded !== lastBeatLog) {
            lastBeatLog = rounded;
            const sec = parsed.value;
            const min = Math.floor(sec / 60);
            const s = (sec % 60).toFixed(0).padStart(2, "0");
            process.stdout.write(`\r  ♩ beat ${rounded}  ${min}:${s}  `);
          }
        } else if (parsed.address === "/beat") {
          broadcast(JSON.stringify({ type: "position", beat: parsed.value }));
        } else if (parsed.address === "/play") {
          const isPlaying = parsed.value > 0.5;
          broadcast(JSON.stringify({ type: isPlaying ? "play" : "stop" }));
          if (isPlaying && !playing) {
            playing = true;
            console.log(`\n  ▶ Playing${currentSong ? `: ${currentSong.title}` : ""}`);
          } else if (!isPlaying && playing) {
            playing = false;
            process.stdout.write("\r");
            console.log(`  ■ Stopped`);
            lastBeatLog = -1;
          }
        }
      } else if (parsed.type === "string") {
        if (parsed.address === "/beat/str" && currentSong && isLyricsDisplay(currentSong)) {
          // REAPER's PROJOFFS-aware beat — downbeat is measure 1, count-in is
          // negative measures. Stays correct at any tempo/playrate.
          const beat = beatStrToBeats(
            parsed.value,
            currentSong.meterMap ?? currentSong.timeSignature[0],
          );
          broadcast(JSON.stringify({ type: "position", beat }));
        } else if ((parsed.address === "/lastmarker/name" || parsed.address === "/lastregion/name") && parsed.value) {
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
      clearInterval(pollTimer);
      udp.close();
      wss.close();
      server.close();
    },
  };
}
