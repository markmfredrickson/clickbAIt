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
 */

import { sceneClock, type SceneFeatures, type SceneSection, type SceneState, type SceneTiming } from "./scene-state.js";

export interface HostSetup {
  sceneUrl: string;
  timing: SceneTiming;
  sections: SceneSection[];
  features?: SceneFeatures;
  width: number;
  height: number;
}

export interface MountedScene {
  /** Draw the frame at project time `t`. */
  draw(t: number): Promise<void>;
  canvas: HTMLCanvasElement;
  remove(): void;
}

declare const p5: new (sketch: (p: any) => void, node?: HTMLElement) => any;

/** Import the scene and run its setup inside `parent`. Rejects if either fails. */
export async function mountScene(o: HostSetup, parent: HTMLElement): Promise<MountedScene> {
  const clock = sceneClock(o.timing, o.sections, o.features);
  let now: SceneState = clock.at(0);
  const song = { width: o.width, height: o.height, sections: o.sections, now: () => now };
  const scene = (await import(o.sceneUrl)).default as (p: any, s: typeof song) => void;
  if (typeof scene !== "function") throw new Error(`${o.sceneUrl} has no default export function`);

  const holder = document.createElement("div");
  parent.appendChild(holder);
  let instance: any;
  try {
    await new Promise<void>((ready, fail) => {
      instance = new p5((p: any) => {
        scene(p, song);
        const own = p.setup;
        p.setup = async () => {
          try {
            await own?.call(p);
            p.pixelDensity(1);
            p.randomSeed(1);
            p.noiseSeed(1);
            p.noLoop();
            ready();
          } catch (e) {
            fail(e);
          }
        };
      }, holder);
    });
  } catch (e) {
    instance?.remove();
    holder.remove();
    throw e;
  }
  const canvas = holder.querySelector("canvas");
  if (!canvas) {
    instance.remove();
    holder.remove();
    throw new Error("the scene made no canvas");
  }
  return {
    canvas,
    async draw(t) {
      now = clock.at(t);
      await instance.redraw();
    },
    remove() {
      instance.remove();
      holder.remove();
    },
  };
}
