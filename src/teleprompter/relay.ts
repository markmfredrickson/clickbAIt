/**
 * OSC → WebSocket relay server.
 *
 * Listens for OSC messages from REAPER, broadcasts to browser clients.
 * Supports multiple songs via a songs directory — switches automatically
 * when REAPER sends a region name matching a song slug.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { createSocket } from "node:dgram";
import { WebSocketServer, type WebSocket } from "ws";
import QRCode from "qrcode";
import { networkInterfaces, tmpdir } from "node:os";
import { createEinkRoutes } from "./eink/routes.js";
import { renderPages } from "./eink/render.js";
import { createChartRoutes } from "../charts/routes.js";
import { PRESETS, presetHref } from "./display-options.js";
import type { ChartsFile } from "../charts/build.js";
import type { SongPayload, TempoPoint } from "./types.js";
import type { LyricsDisplay, MeterSegment } from "./lyrics-display.js";
import { toSlug } from "../core/dsongl/index.js";
import { Curve, type Anchor } from "../core/curve.js";
import { encode, asFloat } from "../core/osc.js";
import {
  apply as applyIntent,
  advance as advanceShow,
  initialState as initialShowState,
  type Intent,
  type ShowEffect,
  type ShowSection,
  type ShowState,
} from "./show-state.js";

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
  /** Where REAPER listens for OSC — its device "local listen port". */
  reaperHost?: string;
  reaperPort?: number;
  /**
   * REAPER track numbers for the tracks the bail mutes. build-rpp emits these
   * in a fixed order, so the defaults hold for any generated project; override
   * only for a hand-built one. Muting needs DEVICE_TRACK_COUNT above 0 in the
   * OSC pattern config — it ships at 0 to keep traffic down.
   */
  tracks?: { click?: number; cues?: number; stems?: number };
  /** Where rendered e-ink pages are cached (default: a folder in the OS temp dir). */
  einkCacheDir?: string;
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

/** The one file a song folder offers the client, as a suffix. */
const DISPLAY_SUFFIX = ".lyrics-display.json";

/**
 * Song slugs to offer for a directory listing.
 *
 * Allowlist, not a blocklist: a song folder is mostly derived sidecars
 * (`*.song.json`, `*.lookup.json`, `*.beats.json`, `*.beatmap.json`,
 * `package.json`), so listing every `.json` advertised them as playable and
 * they then failed the schema check on load. Only the built display file is a
 * song. Shared with the startup banner so the two can't drift apart.
 */
export function songSlugsFromFiles(files: readonly string[]): string[] {
  return files
    .filter((f) => f.endsWith(DISPLAY_SUFFIX))
    .map((f) => f.slice(0, -DISPLAY_SUFFIX.length));
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
  const reaperHost = opts.reaperHost ?? "127.0.0.1";
  const reaperPort = opts.reaperPort ?? 8000;
  const trackOf = { click: 1, cues: 2, stems: 3, ...opts.tracks };

  // ── Show control (bail / vamp / stop) ──
  // The state machine is shared with both browser clients so all three agree;
  // the relay's extra job is turning a transition's effects into OSC.
  let showState: ShowState = initialShowState;
  let lastBeat = 0;
  let playing = false;
  const control = createSocket("udp4");

  function toReaper(address: string, args: (number | string | boolean)[] = []): void {
    const buf = encode(address, args);
    control.send(buf, reaperPort, reaperHost, (err) => {
      if (err) console.error(`  ✗ OSC → REAPER failed: ${err.message}`);
    });
  }

  /** Sections in the shape the state machine wants, from either song format. */
  function showSections(song: LoadedSong | null): ShowSection[] {
    if (!song) return [];
    if (isLyricsDisplay(song)) {
      // LyricsDisplay carries only a start beat per section, so a section runs
      // until the next one starts (the last to the end of the last word).
      const secs = song.display?.sections ?? [];
      const end = song.words?.length ? Math.max(...song.words.map((w) => w.endBeat)) : 0;
      // No `vamp` flag yet — authored open sections aren't in the manifest
      // schema, so every vamp is currently ad-hoc (chosen from the drawer).
      return secs.map((s, i) => ({
        name: s.name,
        beat: s.startBeat,
        durationBeats: (i + 1 < secs.length ? secs[i + 1].startBeat : Math.max(end, s.startBeat)) - s.startBeat,
      }));
    }
    return song.sections.map((s) => ({ name: s.name, beat: s.beat, durationBeats: s.durationBeats }));
  }

  /** Push a transition's effects to REAPER. Locate is deliberately not sent. */
  function runEffect(effect: ShowEffect): void {
    if (effect.click !== undefined) toReaper(`/track/${trackOf.click}/mute`, [asFloat(effect.click ? 0 : 1)]);
    if (effect.cues !== undefined) toReaper(`/track/${trackOf.cues}/mute`, [asFloat(effect.cues ? 0 : 1)]);
    if (effect.repeat !== undefined) toReaper("/repeat", [asFloat(effect.repeat ? 1 : 0)]);
    if (effect.transport === "stop") toReaper("/stop", [asFloat(1)]);
    // Seeking to a section needs a locate REAPER's OSC vocabulary may not
    // expose (see scripts/osc-probe.ts). Until that's settled, re-entry moves
    // the DISPLAY and leaves the transport alone — so say so rather than
    // silently doing half of it.
    if (effect.locateBeat !== undefined) {
      console.log(`  ⤳ re-entry at beat ${effect.locateBeat.toFixed(0)} — display only, no locate sent`);
    }
  }

  function pushShowState(): void {
    broadcast(JSON.stringify({ type: "show-state", state: showState, playing }));
  }

  /**
   * The transport stopping ends the show state along with it. Otherwise a bail
   * or a vamp outlives the take that produced it and is waiting, wrongly armed,
   * when the next one starts.
   */
  function resetShowState(): void {
    if (showState.mode === "following") return;
    showState = initialShowState;
    runEffect({ click: true, cues: true, repeat: false });
    console.log(`  ⎉ transport stopped → following (show state reset)`);
    // The caller pushes — it has to anyway, to carry the new `playing` value.
  }

  /**
   * Every position update goes through here: fan the beat out, then let the
   * state machine handle the two things that happen with nobody touching the
   * control — a marked section engaging its vamp, and a loop ending while
   * we're leaving it.
   */
  function onPosition(beat: number): void {
    lastBeat = beat;
    broadcast(JSON.stringify({ type: "position", beat }));
    const { state, effect } = advanceShow(showState, showSections(currentSong), beat);
    if (state === showState) return;
    showState = state;
    runEffect(effect);
    pushShowState();
  }

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

  // E-ink pages for the current song, rendered at each device's size.
  // The current song's chords, from the charts file beside its lyrics display.
  function currentChords(): { sections: ChartsFile["sections"]; chords: NonNullable<ChartsFile["chords"]> } | null {
    const songDir = currentCacheEntry?.filePath ? dirname(currentCacheEntry.filePath) : songsDirs[0];
    try {
      const file = JSON.parse(readFileSync(join(songDir, `${currentSlug}.charts.json`), "utf8")) as ChartsFile;
      return file.chords ? { sections: file.sections, chords: file.chords } : null;
    } catch {
      return null;
    }
  }

  const eink = createEinkRoutes({
    current: () =>
      currentSong
        ? { slug: currentSlug, song: currentSong, version: String(currentCacheEntry?.mtimeMs ?? 0), chords: currentChords() }
        : null,
    render: renderPages,
    cacheDir: opts.einkCacheDir ?? join(tmpdir(), "clickbait-eink"),
  });

  // Chart channels for the current song. The charts file sits beside the
  // lyrics display and is read per request, so a rebuild shows up at once.
  const charts = createChartRoutes({
    current: async () => {
      if (!currentSong || !isLyricsDisplay(currentSong)) return null;
      const songDir = currentCacheEntry?.filePath ? dirname(currentCacheEntry.filePath) : songsDirs[0];
      let file: ChartsFile | null = null;
      try {
        file = JSON.parse(await readFile(join(songDir, `${currentSlug}.charts.json`), "utf8")) as ChartsFile;
      } catch { /* no charts for this song */ }
      return { slug: currentSlug, display: currentSong, charts: file, songDir };
    },
  });

  // Pre-generate QR codes as SVG — one to follow along, one to take control.
  // The join page's one QR code opens the picker, where each person chooses
  // their display. Control (the bail bar) is for whoever runs the show, so it
  // isn't offered there; it stays at /control.
  let qrSvgCache: string | null = null;
  const pickUrl = `${baseUrl}/pick`;
  const pickerButtons = PRESETS.map(
    (p) => `<a class="pick" href="${presetHref(p)}"><span class="pick-name">${escapeHtml(p.name)}</span><span class="pick-note">${escapeHtml(p.note)}</span></a>`,
  ).join("\n      ");
  const pickerStyle = `
    .picks { display: flex; flex-direction: column; gap: 0.75rem; width: min(92vw, 420px); margin-top: 1.5rem; }
    .pick { display: flex; flex-direction: column; align-items: flex-start; padding: 1rem 1.25rem;
            background: #1d1d1d; border: 1px solid #333; border-radius: 10px; color: #fff;
            text-decoration: none; text-align: left; }
    .pick:active, .pick:hover { border-color: #ffcc00; }
    .pick-name { font-size: 1.25rem; font-weight: 700; color: #ffcc00; }
    .pick-note { font-size: 0.9rem; color: #999; margin-top: 0.2rem; }`;

  // HTTP server
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";

    if (url.startsWith("/eink/") && (await eink(req, res))) return;
    if (url.startsWith("/charts/") && (await charts(req, res))) return;

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

    if (url === "/pick") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pick a display — clickbAIt: One Simple Track</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #111; color: #fff; font-family: -apple-system, system-ui, sans-serif;
           display: flex; flex-direction: column; align-items: center; min-height: 100vh; padding: 2rem 1rem; }
    h1 { font-size: 1.4rem; }${pickerStyle}
  </style>
</head>
<body>
  <h1>What should this screen show?</h1>
  <div class="picks">
      ${pickerButtons}
  </div>
</body>
</html>`);
      return;
    }

    if (url === "/" || url === "/join") {
      if (!qrSvgCache) {
        qrSvgCache = await QRCode.toString(pickUrl, { type: "svg" });
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
    .codes { display: flex; flex-wrap: wrap; gap: 2.5rem; justify-content: center; }
    .code { display: flex; flex-direction: column; align-items: center; }
    .qr { width: min(70vw, 300px); height: auto; background: #fff; padding: 1.25rem;
           border-radius: 12px; }
    .qr svg { width: 100%; height: auto; }
    .url { margin-top: 1rem; font-size: 0.95rem; font-family: monospace;
           color: #ffcc00; word-break: break-all; }
    .song-title { font-size: 1.5rem; margin-bottom: 0.5rem; color: #ffcc00;
                   transition: text-shadow 0.5s ease; }
    .song-title.glow { text-shadow: 0 0 20px #ffcc00, 0 0 40px #ffcc00; }${pickerStyle}
  </style>
</head>
<body>
  <h1>clickbAIt: One Simple Track</h1>
  <p class="song-title" id="song-title">${songLine}</p>
  <div class="codes">
    <div class="code">
      <p class="subtitle">Scan to pick your display</p>
      <div class="qr">${qrSvgCache}</div>
      <p class="url">${pickUrl}</p>
    </div>
  </div>
  <div class="picks">
      ${pickerButtons}
  </div>
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
          for (const slug of songSlugsFromFiles(await readdir(dir))) seen.add(slug);
        } catch { /* dir missing — skip */ }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([...seen]));
      return;
    }

    // Serve static files (/prompt is the teleprompter, /lyrics its old name,
    // /control the bail bar,
    // /eink the pre-rendered pages for e-ink screens). Query strings are
    // options for the page, not part of the file name.
    const path = url.split("?")[0];
    const pages: Record<string, string> = {
      "/prompt": "index.html",
      "/lyrics": "index.html",
      "/control": "control.html",
      "/eink": "eink.html",
    };
    const filePath = pages[path] ?? path.slice(1);
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
    ws.send(JSON.stringify({ type: "show-state", state: showState, playing }));

    // Control intents arrive here from /control. Anything on this socket is
    // untrusted input off the LAN, so a malformed message is dropped rather
    // than allowed to throw and take the relay down mid-show.
    ws.on("message", (raw) => {
      let msg: { type?: string; intent?: Intent };
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (msg.type !== "intent" || !msg.intent || typeof msg.intent.action !== "string") return;

      // Belt and braces: a throw in here would kill this socket's handler and
      // silently deafen the control page for the rest of the show, which is
      // exactly when you'd least notice and most care.
      try {
        const sections = showSections(currentSong);
        const { state, effect } = applyIntent(showState, msg.intent, sections, lastBeat, playing);
        if (state === showState) return;        // rejected — nothing to say
        showState = state;
        runEffect(effect);
        pushShowState();
        console.log(`  ⎉ ${msg.intent.action} → ${state.mode}${state.loop ? ` (${state.loop.from}–${state.loop.to})` : ""}`);
      } catch (err) {
        console.error(`  ✗ intent "${msg.intent.action}" failed:`, err instanceof Error ? err.message : err);
      }
    });

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
          onPosition(beat);
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
          onPosition(parsed.value);
        } else if (parsed.address === "/play") {
          const isPlaying = parsed.value > 0.5;
          broadcast(JSON.stringify({ type: isPlaying ? "play" : "stop" }));
          if (isPlaying && !playing) {
            playing = true;
            pushShowState();
            console.log(`\n  ▶ Playing${currentSong ? `: ${currentSong.title}` : ""}`);
          } else if (!isPlaying && playing) {
            playing = false;
            process.stdout.write("\r");
            console.log(`  ■ Stopped`);
            lastBeatLog = -1;
            resetShowState();
            pushShowState();
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
          onPosition(beat);
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
