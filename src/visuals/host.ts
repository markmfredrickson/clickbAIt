/**
 * Mounts a p5 scene in the page. The offline renderer and the live preview
 * both draw through this, so a frame is the same in each. The scene module's
 * default export is a p5 instance-mode sketch that also takes the song:
 *
 *   export default function scene(p, song) {
 *     p.setup = () => p.createCanvas(song.width, song.height);
 *     p.draw = () => { const s = song.now(); ... };
 *   }
 *
 * `song.now()` is the state for the frame being drawn. Scenes must draw from
 * it and never from the wall clock (`millis`, `frameCount`), so a frame is
 * the same however it was reached.
 *
 * Footage: `song.clip(name, at)` in setup opens a clip from `media/media.json`;
 * `at(state)` says which clip second each frame wants (or null for none).
 * Before each frame the host seeks the clip there, and the scene draws
 * `clip.frame` when `clip.visible`.
 */

import { sceneClock, type SceneFeatures, type SceneSection, type SceneState, type SceneTiming } from "./scene-state.js";

/** What a scene needs to know about a clip in `media/media.json`. */
export interface HostClip {
  file: string;
  fps: number;
  duration: number;
  width: number;
  height: number;
  /** Shot boundaries in clip seconds, from `media analyze`. */
  shots?: { start: number; end: number }[];
  /** Clip seconds where something lands (a flare), from `media analyze`. */
  strikes?: number[];
}

export interface HostSetup {
  sceneUrl: string;
  timing: SceneTiming;
  sections: SceneSection[];
  features?: SceneFeatures;
  media?: Record<string, HostClip>;
  /** Base URL that clip files resolve against (the scene's folder). */
  mediaBase?: string;
  width: number;
  height: number;
  /**
   * Wait for every clip to land on its exact frame before drawing (offline
   * renders). The preview doesn't wait: it asks for the frame and draws what
   * the video has, so the music never stalls.
   */
  exactClips?: boolean;
}

export interface MountedScene {
  /** Draw the frame at project time `t`. */
  draw(t: number): Promise<void>;
  canvas: HTMLCanvasElement;
  remove(): void;
}

/** What `song.clip` hands a scene. */
interface SceneClip {
  name: string;
  /** Draw this with `p.image(clip.frame, ...)`. */
  frame: any;
  visible: boolean;
  width: number;
  height: number;
  duration: number;
  shots: { start: number; end: number }[];
  strikes: number[];
}

/** Seconds of song a clip can go unused before its video is let go. */
const RELEASE_AFTER = 20;

declare const p5: new (sketch: (p: any) => void, node?: HTMLElement) => any;

/** Resolve once the element has fired `event`. */
const once = (el: HTMLElement, event: string) => new Promise<void>((resolve) => el.addEventListener(event, () => resolve(), { once: true }));

/** Seek a paused video to `t` and wait until the frame is there. */
async function seekExactly(video: HTMLVideoElement, t: number): Promise<void> {
  if (!video.seeking && Math.abs(video.currentTime - t) < 1e-6) return;
  const done = once(video, "seeked");
  video.currentTime = t;
  await done;
}

/** Import the scene and run its setup inside `parent`. Rejects if either fails. */
export async function mountScene(o: HostSetup, parent: HTMLElement): Promise<MountedScene> {
  const clock = sceneClock(o.timing, o.sections, o.features);
  let now: SceneState = clock.at(0);
  let p: any;
  // A clip's video loads the first time a frame needs it and is let go once
  // the song has gone RELEASE_AFTER seconds without it, so a song with many
  // HD clips never holds them all in memory.
  interface Entry {
    clip: SceneClip;
    info: HostClip;
    at: (s: SceneState) => number | null;
    video: HTMLVideoElement;
    url: string;
    loading?: Promise<void>;
    loaded: boolean;
    lastUsed: number;
  }
  const clips: Entry[] = [];
  const load = (e: Entry): Promise<void> =>
    (e.loading ??= new Promise<void>((resolve, reject) => {
      e.video.preload = "auto";
      e.video.src = e.url;
      e.video.load();
      once(e.video, "loadeddata").then(() => {
        e.loaded = true;
        resolve();
      });
      once(e.video, "error").then(() => reject(new Error(`couldn't load clip ${e.info.file}`)));
    }));
  const release = (e: Entry) => {
    e.video.pause();
    e.video.removeAttribute("src");
    e.video.load();
    e.loaded = false;
    e.loading = undefined;
  };

  const song = {
    width: o.width,
    height: o.height,
    sections: o.sections,
    now: () => now,
    timeOf: (beat: number) => clock.timeOf(beat),
    clip(name: string, at: (s: SceneState) => number | null): SceneClip {
      const info = o.media?.[name];
      if (!info) throw new Error(`no clip "${name}" in media/media.json; clips: ${Object.keys(o.media ?? {}).join(", ") || "none"}`);
      if (!p) throw new Error("song.clip must be called in setup");
      const url = new URL(info.file, o.mediaBase ?? location.href).href;
      const el = p.createVideo(url);
      el.hide();
      const video = el.elt as HTMLVideoElement;
      video.muted = true;
      video.pause();
      const clip: SceneClip = {
        name,
        frame: el,
        visible: false,
        width: info.width,
        height: info.height,
        duration: info.duration,
        shots: info.shots ?? [],
        strikes: info.strikes ?? [],
      };
      const entry: Entry = { clip, info, at, video, url, loaded: false, lastUsed: -Infinity };
      release(entry); // nothing loads until a frame needs it
      clips.push(entry);
      return clip;
    },
  };
  const scene = (await import(o.sceneUrl)).default as (p: any, s: typeof song) => void;
  if (typeof scene !== "function") throw new Error(`${o.sceneUrl} has no default export function`);

  const holder = document.createElement("div");
  parent.appendChild(holder);
  let instance: any;
  const teardown = () => {
    instance?.remove();
    holder.remove();
  };
  try {
    await new Promise<void>((ready, fail) => {
      instance = new p5((sketch: any) => {
        p = sketch;
        scene(sketch, song);
        const own = sketch.setup;
        sketch.setup = async () => {
          try {
            await own?.call(sketch);
            sketch.pixelDensity(1);
            sketch.randomSeed(1);
            sketch.noiseSeed(1);
            sketch.noLoop();
            ready();
          } catch (e) {
            fail(e);
          }
        };
      }, holder);
    });
  } catch (e) {
    teardown();
    throw e;
  }
  const canvas = holder.querySelector("canvas");
  if (!canvas) {
    teardown();
    throw new Error("the scene made no canvas");
  }

  return {
    canvas,
    async draw(t) {
      now = clock.at(t);
      await Promise.all(
        clips.map(async (e) => {
          const { clip, info, at, video } = e;
          const want = at(now);
          const needed = want !== null && want >= 0 && want < info.duration;
          if (!needed) {
            clip.visible = false;
            if (e.loaded && Math.abs(t - e.lastUsed) > RELEASE_AFTER) release(e);
            return;
          }
          e.lastUsed = t;
          // Aim at the middle of the frame, so rounding never picks its neighbor.
          const target = (Math.floor(want! * info.fps + 1e-6) + 0.5) / info.fps;
          if (o.exactClips) {
            await load(e);
            await seekExactly(video, target);
            clip.visible = true;
          } else {
            // The preview never waits: until the clip has loaded it just isn't shown.
            load(e).catch(() => {});
            clip.visible = e.loaded;
            if (e.loaded && !video.seeking && Math.abs(video.currentTime - target) > 0.5 / info.fps) video.currentTime = target;
          }
        }),
      );
      await instance.redraw();
    },
    remove: teardown,
  };
}
