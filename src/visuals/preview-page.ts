/**
 * The preview page: the audio element is the clock, the scene draws at its
 * current time on every animation frame, and a save swaps the scene in place.
 * A scene that fails to load or draw leaves the last good one running, with
 * the error shown over it.
 */

import { mountScene, type HostSetup, type MountedScene } from "./host.js";
import { sceneClock, type SceneFeatures, type SceneSection, type SceneTiming } from "./scene-state.js";

interface Config {
  scene: string;
  width: number;
  height: number;
}
interface Song {
  timing: SceneTiming;
  sections: SceneSection[];
  features?: SceneFeatures;
  media?: HostSetup["media"];
}

const config = (window as any).previewConfig as Config;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const audio = $<HTMLAudioElement>("audio");
const stage = $("stage");
const errorBox = $("error");
const scrub = $<HTMLInputElement>("scrub");
const pos = $("pos");

let song: Song;
let current: MountedScene | undefined;
let version = 0;
let drawing = false;

const showError = (e: unknown) => (errorBox.textContent = e instanceof Error ? `${e.name}: ${e.message}` : String(e));

async function load(): Promise<void> {
  const v = ++version;
  const setup: HostSetup = {
    sceneUrl: `/scene/${config.scene}?v=${Date.now()}`,
    ...song,
    mediaBase: `${location.origin}/scene/`,
    width: config.width,
    height: config.height,
  };
  let next: MountedScene | undefined;
  try {
    next = await mountScene(setup, stage);
    await next.draw(audio.currentTime); // a scene that throws on its first frame is no better than one that won't load
  } catch (e) {
    next?.remove();
    if (v === version) showError(e);
    return;
  }
  if (v !== version) return next.remove(); // a newer save already won
  current?.remove();
  current = next;
  current.canvas.parentElement!.classList.add("live");
  errorBox.textContent = "";
}

async function loadSong(): Promise<void> {
  song = await (await fetch("/song.json")).json();
  renderSections();
}

function renderSections(): void {
  const box = $("sections");
  box.replaceChildren();
  const clock = sceneClock(song.timing, song.sections);
  const curveTime = (beat: number) => {
    // Find the time of `beat` by bisecting the clock (the curve is monotonic).
    let lo = -60;
    let hi = 3600;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (clock.at(mid).beat < beat) lo = mid;
      else hi = mid;
    }
    return hi;
  };
  song.sections.forEach((s, i) => {
    const b = document.createElement("button");
    b.textContent = s.name;
    b.dataset.index = String(i);
    b.onclick = () => seek(Math.max(0, curveTime(s.start)));
    box.appendChild(b);
  });
}

function seek(t: number): void {
  audio.currentTime = t;
}

async function tick(): Promise<void> {
  requestAnimationFrame(tick);
  if (!current || drawing) return;
  drawing = true;
  try {
    await current.draw(audio.currentTime);
    if (errorBox.dataset.from === "draw") errorBox.textContent = "";
  } catch (e) {
    showError(e);
    errorBox.dataset.from = "draw";
  } finally {
    drawing = false;
  }
  const s = sceneClock(song.timing, song.sections).at(audio.currentTime);
  pos.textContent = `${audio.currentTime.toFixed(2)}s  ${s.section ? s.section.name : "count-in"}  bar ${s.bar}  beat ${s.beatInBar}`;
  if (document.activeElement !== scrub) scrub.value = String(audio.currentTime);
  for (const b of document.querySelectorAll<HTMLElement>("#sections button")) {
    b.classList.toggle("now", Number(b.dataset.index) === s.section?.index);
  }
}

$("play").onclick = () => (audio.paused ? audio.play() : audio.pause());
audio.onplay = () => ($("play").textContent = "Pause");
audio.onpause = () => ($("play").textContent = "Play");
audio.onloadedmetadata = () => (scrub.max = String(audio.duration));
scrub.oninput = () => seek(Number(scrub.value));
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && document.activeElement?.tagName !== "BUTTON") {
    e.preventDefault();
    audio.paused ? audio.play() : audio.pause();
  }
});

new EventSource("/events").onmessage = async (e) => {
  if (e.data === "song") await loadSong();
  await load();
};

(window as any).preview = { seek };

void (async () => {
  await loadSong();
  await load();
  requestAnimationFrame(tick);
})();
