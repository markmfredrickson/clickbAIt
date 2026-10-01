/**
 * Live preview for writing a scene: a local page that plays the song's mix
 * and draws the scene at the audio's current time, and swaps the scene in
 * whenever its file is saved, without stopping the music.
 *
 * The page reads the same project-time curve, sections and beat features the
 * offline renderer does, through the same scene mount, so what plays here is
 * what renders.
 */

import { createServer, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync, createReadStream, watch, type FSWatcher } from "node:fs";
import { basename, dirname, extname, join, normalize } from "node:path";
import type { AddressInfo } from "node:net";
import { P5_MIN, bundlePage } from "./page-assets.js";

export interface PreviewOptions {
  /** The scene module. Files beside it are served too, and watched. */
  scene: string;
  /** `<slug>.lyrics-display.json`: the project-time curve. */
  timing: string;
  /** `<slug>.rows.json`: the sections. */
  rows: string;
  /** `<slug>.beat-features.json`, when the song has one. */
  features?: string;
  /** The mix to play: project time is its time. */
  audio: string;
  port: number;
  width: number;
  height: number;
}

export interface Preview {
  url: string;
  close(): Promise<void>;
}

const TYPES: Record<string, string> = {
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".wav": "audio/wav",
  ".opus": "audio/ogg",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
};

const page = (o: PreviewOptions) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Scene preview</title>
<style>
  :root { --bg: #000; --bar: #161616; --ink: #eee; --dim: #999; --err: #ff6b6b; }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--ink); font: 14px system-ui, sans-serif; }
  body { display: flex; flex-direction: column; }
  #stage { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; position: relative; }
  #stage > div { display: none; }
  #stage > div.live { display: block; }
  #stage canvas { display: block; max-width: 100vw; max-height: calc(100vh - 88px); width: auto !important; height: auto !important; aspect-ratio: ${o.width} / ${o.height}; }
  #error { position: absolute; left: 16px; right: 16px; bottom: 16px; white-space: pre-wrap; font: 13px ui-monospace, monospace; color: var(--err); background: rgba(0,0,0,.8); padding: 0; }
  #error:not(:empty) { padding: 10px 12px; }
  #bar { background: var(--bar); padding: 8px 16px; display: grid; gap: 6px; }
  #row { display: flex; gap: 12px; align-items: center; }
  #row button { background: none; color: var(--ink); border: 1px solid #444; border-radius: 4px; padding: 4px 10px; cursor: pointer; }
  #scrub { flex: 1; }
  #pos { color: var(--dim); font-variant-numeric: tabular-nums; min-width: 22ch; text-align: right; }
  #sections { display: flex; gap: 6px; flex-wrap: wrap; }
  #sections button { background: none; color: var(--dim); border: 1px solid #333; border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 12px; }
  #sections button.now { color: var(--ink); border-color: #888; }
</style>
<script src="/p5.min.js"></script><script src="/preview.js" defer></script></head>
<body>
  <div id="stage"><pre id="error"></pre></div>
  <div id="bar">
    <div id="row"><button id="play">Play</button><input id="scrub" type="range" min="0" step="0.01" value="0"><span id="pos"></span></div>
    <div id="sections"></div>
  </div>
  <audio id="audio" src="/audio" preload="auto"></audio>
  <script>window.previewConfig = ${JSON.stringify({ scene: basename(o.scene), width: o.width, height: o.height })};</script>
</body></html>`;

/** Send a file, honoring a byte range so the audio element can seek. */
function sendFile(res: ServerResponse, file: string, range: string | undefined) {
  const size = statSync(file).size;
  const type = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : size - Number(m[2]);
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
      return;
    }
    res.writeHead(206, { "Content-Type": type, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes" });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes", "Cache-Control": "no-store" });
  createReadStream(file).pipe(res);
}

export async function startPreview(o: PreviewOptions): Promise<Preview> {
  const script = await bundlePage("preview-page.ts");
  const sceneDir = dirname(o.scene);
  const listeners = new Set<ServerResponse>();
  const notify = (event: "scene" | "song") => {
    for (const res of listeners) res.write(`data: ${event}\n\n`);
  };

  const song = () => ({
    timing: { curve: JSON.parse(readFileSync(o.timing, "utf8")).curve },
    sections: JSON.parse(readFileSync(o.rows, "utf8")).sections,
    features: o.features && existsSync(o.features) ? JSON.parse(readFileSync(o.features, "utf8")) : undefined,
  });

  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    try {
      if (path === "/") return void res.writeHead(200, { "Content-Type": "text/html" }).end(page(o));
      if (path === "/preview.js") return void res.writeHead(200, { "Content-Type": TYPES[".js"] }).end(script);
      if (path === "/p5.min.js") return void res.writeHead(200, { "Content-Type": TYPES[".js"] }).end(readFileSync(P5_MIN));
      if (path === "/song.json") return void res.writeHead(200, { "Content-Type": TYPES[".json"], "Cache-Control": "no-store" }).end(JSON.stringify(song()));
      if (path === "/audio") return sendFile(res, o.audio, req.headers.range);
      if (path === "/events") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
        res.write(": connected\n\n");
        listeners.add(res);
        req.on("close", () => listeners.delete(res));
        return;
      }
      if (path.startsWith("/scene/")) {
        const file = normalize(join(sceneDir, path.slice("/scene/".length)));
        if (file.startsWith(sceneDir) && existsSync(file) && statSync(file).isFile()) {
          res.setHeader("Cache-Control", "no-store");
          return sendFile(res, file, req.headers.range);
        }
      }
      res.writeHead(404).end();
    } catch (e) {
      res.writeHead(500, { "Content-Type": "text/plain" }).end(String(e));
    }
  });

  // Saves arrive as a burst of events; settle before telling the page.
  const data = new Set([o.timing, o.rows, o.features].filter(Boolean).map((f) => basename(f!)));
  const pending = new Map<string, NodeJS.Timeout>();
  const settle = (event: "scene" | "song") => {
    clearTimeout(pending.get(event));
    pending.set(event, setTimeout(() => notify(event), 60));
  };
  const watchers: FSWatcher[] = [];
  const watchDir = (dir: string) =>
    watchers.push(
      watch(dir, (_kind, name) => {
        if (!name) return;
        if (dir === dirname(o.timing) && data.has(String(name))) settle("song");
        else if (dir === sceneDir) settle("scene");
      }),
    );
  watchDir(sceneDir);
  if (dirname(o.timing) !== sceneDir) watchDir(dirname(o.timing));

  await new Promise<void>((resolve) => server.listen(o.port, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    async close() {
      for (const w of watchers) w.close();
      for (const t of pending.values()) clearTimeout(t);
      for (const res of listeners) res.end();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
