/**
 * Render a p5 scene to a video, offline: headless Chrome draws each frame at
 * a fixed step of project time, and ffmpeg encodes them with a keyframe on
 * every beat so a player following the beat clock can seek straight to any
 * beat after a jump.
 */

import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { basename, dirname, join, normalize } from "node:path";
import { Curve } from "../core/curve.js";
import type { SceneFeatures, SceneSection, SceneTiming } from "./scene-state.js";
import type { HostClip, HostSetup } from "./host.js";
import { P5_MIN, bundlePage } from "./page-assets.js";

export interface RenderOptions {
  /** The scene module (`<slug>.scene.js`). Files beside it are served too. */
  scene: string;
  timing: SceneTiming;
  sections: SceneSection[];
  features?: SceneFeatures;
  /** Clips from `media/media.json`, by name; files resolve against the scene's folder. */
  media?: Record<string, HostClip>;
  fps: number;
  width: number;
  height: number;
  out: string;
  /** Seconds to keep rendering past the song's end, for a fade or ring-out. */
  tail?: number;
  /** Stop at this many project seconds instead of the song's end (a demo, a test). */
  until?: number;
  /** Called after each frame, for progress. */
  onFrame?: (i: number, total: number) => void;
}

const ORIGIN = "http://visuals.local";
/** The most of a video file one response carries; the player asks for more as it goes. */
const MAX_RANGE = 8 * 1024 * 1024;
const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;background:#000;overflow:hidden}</style>
<script src="/p5.min.js"></script><script src="/host.js"></script></head><body></body></html>`;

/** Project seconds of every whole beat from the start of the video to its end. */
export function beatTimes(timing: SceneTiming, duration: number): number[] {
  const curve = new Curve(timing.curve);
  const out: number[] = [];
  for (let b = Math.ceil(curve.toBeat(0) - 1e-9); ; b++) {
    const t = curve.toTime(b);
    if (t > duration + 1e-9) break;
    if (t >= 0) out.push(t);
  }
  return out;
}

export async function renderScene(o: RenderOptions): Promise<void> {
  const last = o.sections[o.sections.length - 1];
  if (!last) throw new Error("renderScene: the song has no sections");
  const full = new Curve(o.timing.curve).toTime(last.end) + (o.tail ?? 0);
  const duration = o.until === undefined ? full : Math.min(full, o.until);
  const total = Math.round(duration * o.fps);
  const keys = beatTimes(o.timing, duration).map((t) => t.toFixed(4)).join(",");

  const ffmpeg = spawn("ffmpeg", [
    "-v", "error", "-y",
    "-f", "image2pipe", "-framerate", String(o.fps), "-c:v", "mjpeg", "-i", "-",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
    "-force_key_frames", keys, "-x264-params", "scenecut=0",
    "-movflags", "+faststart", o.out,
  ], { stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  ffmpeg.stderr.on("data", (d) => (stderr += d));
  const finished = new Promise<void>((resolve, reject) => {
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr}`))));
  });
  // If the scene throws, ffmpeg then fails for want of frames; the scene's error
  // is the one to report, so don't let this rejection go unhandled meanwhile.
  finished.catch(() => {});

  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    const host = await bundlePage("render-page.ts");
    const sceneDir = dirname(o.scene);
    await page.route(`${ORIGIN}/**`, async (route) => {
      const path = decodeURIComponent(new URL(route.request().url()).pathname);
      const send = (body: string | Buffer, contentType: string) => route.fulfill({ status: 200, body, contentType });
      if (path === "/") return send(PAGE, "text/html");
      if (path === "/host.js") return send(host, "application/javascript");
      if (path === "/p5.min.js") return send(readFileSync(P5_MIN), "application/javascript");
      if (path.startsWith("/scene/")) {
        const file = normalize(join(sceneDir, path.slice("/scene/".length)));
        if (file.startsWith(sceneDir) && existsSync(file)) {
          const type = file.endsWith(".js") ? "application/javascript" : file.endsWith(".mp4") ? "video/mp4" : "application/octet-stream";
          if (type !== "video/mp4") return route.fulfill({ status: 200, body: readFileSync(file), headers: { "Content-Type": type } });
          // Video: serve byte ranges, read from disk a piece at a time, so a
          // song's worth of HD clips never sits in memory at once.
          const size = statSync(file).size;
          const range = route.request().headers()["range"]?.match(/^bytes=(\d+)-(\d*)$/);
          const start = range ? Number(range[1]) : 0;
          const end = Math.min(range?.[2] ? Number(range[2]) : size - 1, start + MAX_RANGE - 1, size - 1);
          const body = Buffer.alloc(end - start + 1);
          const fd = openSync(file, "r");
          try {
            readSync(fd, body, 0, body.length, start);
          } finally {
            closeSync(fd);
          }
          return route.fulfill({
            status: 206,
            body,
            headers: { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes" },
          });
        }
      }
      return route.fulfill({ status: 404, body: "" });
    });
    await page.goto(`${ORIGIN}/`);

    const setup: HostSetup = {
      sceneUrl: `/scene/${basename(o.scene)}`,
      timing: o.timing,
      sections: o.sections,
      features: o.features,
      media: o.media,
      mediaBase: `${ORIGIN}/scene/`,
      exactClips: true,
      width: o.width,
      height: o.height,
    };
    await page.evaluate((s) => (window as any).sceneHost.setup(s), setup);

    for (let i = 0; i < total; i++) {
      if (errors.length) throw new Error(`scene error: ${errors[0]}`);
      const url: string = await page.evaluate((t) => (window as any).sceneHost.frame(t), i / o.fps);
      const jpeg = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
      if (!ffmpeg.stdin.write(jpeg)) await new Promise((r) => ffmpeg.stdin.once("drain", r));
      o.onFrame?.(i, total);
    }
  } finally {
    ffmpeg.stdin.end();
    await browser.close();
  }
  await finished;
}
