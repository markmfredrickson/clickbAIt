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
  const clips: { clip: SceneClip; info: HostClip; at: (s: SceneState) => number | null; video: HTMLVideoElement }[] = [];

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
      const el = p.createVideo(new URL(info.file, o.mediaBase ?? location.href).href);
      el.hide();
      const video = el.elt as HTMLVideoElement;
      video.muted = true;
      video.preload = "auto";
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
      clips.push({ clip, info, at, video });
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
    await Promise.all(
      clips.map(({ video, info }) =>
        video.readyState >= 2
          ? undefined
          : Promise.race([
              once(video, "loadeddata"),
              once(video, "error").then(() => Promise.reject(new Error(`couldn't load clip ${info.file}`))),
            ]),
      ),
    );
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
        clips.map(async ({ clip, info, at, video }) => {
          const want = at(now);
          clip.visible = want !== null && want >= 0 && want < info.duration;
          if (!clip.visible) return;
          // Aim at the middle of the frame, so rounding never picks its neighbor.
          const target = (Math.floor(want! * info.fps + 1e-6) + 0.5) / info.fps;
          if (o.exactClips) await seekExactly(video, target);
          else if (!video.seeking && Math.abs(video.currentTime - target) > 0.5 / info.fps) video.currentTime = target;
        }),
      );
      await instance.redraw();
    },
    remove: teardown,
  };
}
