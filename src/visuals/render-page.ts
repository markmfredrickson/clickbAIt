/** The offline renderer's side of the page: draw a frame, hand it back as a JPEG. */

import { mountScene, type HostSetup, type MountedScene } from "./host.js";

let scene: MountedScene | undefined;

async function setup(o: HostSetup): Promise<void> {
  scene = await mountScene(o, document.body);
}

/** Draw the frame at project time `t` and return it as a JPEG data URL. */
async function frame(t: number): Promise<string> {
  if (!scene) throw new Error("sceneHost.setup has not run");
  await scene.draw(t);
  return scene.canvas.toDataURL("image/jpeg", 0.95);
}

(window as any).sceneHost = { setup, frame };
