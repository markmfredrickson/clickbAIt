/**
 * Runs a p5 scene inside the page, for the offline renderer (and later the
 * live preview). The scene module's default export is a p5 instance-mode
 * sketch that also takes the song:
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

declare const p5: new (sketch: (p: any) => void) => any;

let draw: ((t: number) => Promise<void>) | undefined;
let canvas: HTMLCanvasElement | undefined;

async function setup(o: HostSetup): Promise<void> {
  const clock = sceneClock(o.timing, o.sections, o.features);
  let now: SceneState = clock.at(0);
  const song = { width: o.width, height: o.height, sections: o.sections, now: () => now };
  const scene = (await import(o.sceneUrl)).default as (p: any, s: typeof song) => void;

  let instance: any;
  await new Promise<void>((ready) => {
    instance = new p5((p: any) => {
      scene(p, song);
      const own = p.setup;
      p.setup = async () => {
        await own?.call(p);
        p.pixelDensity(1);
        p.randomSeed(1);
        p.noiseSeed(1);
        p.noLoop();
        ready();
      };
    });
  });
  canvas = document.querySelector("canvas") ?? undefined;
  draw = async (t) => {
    now = clock.at(t);
    await instance.redraw();
  };
}

/** Draw the frame at project time `t` and return it as a JPEG data URL. */
async function frame(t: number): Promise<string> {
  if (!draw || !canvas) throw new Error("sceneHost.setup has not run, or the scene made no canvas");
  await draw(t);
  return canvas.toDataURL("image/jpeg", 0.95);
}

(window as any).sceneHost = { setup, frame };
