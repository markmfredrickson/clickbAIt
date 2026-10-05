/**
 * An edit as a DaVinci Resolve timeline: `visuals/edit.json` written out as
 * FCPXML, which Resolve imports (File > Import > Timeline).
 *
 * The edit stays the source of the cut. Resolve gets the same shots at the
 * same frames, the dissolves, a marker per section, the sound effects and the
 * song's mix to judge sync by, and owns what ffmpeg's filter chains did: the
 * looks and the film.
 * Clips are named by their look, so a look's shots can be found and graded
 * together. The Ken Burns pushes and the per-shot brightness lift don't come
 * across; grade those in Resolve.
 */

import { pathToFileURL } from "node:url";
import { layout, shotTiming, type Edit } from "./edit.js";

/** A clip's file and what `footage/footage.json` records about it. */
export interface SourceInfo {
  /** Absolute path. */
  path: string;
  duration: number;
  fps: number;
  width: number;
  height: number;
}

/** A source time at a time in the shot: the shot's first and last frames, for a linear retime. */
export interface MapPoint {
  /** Seconds from the shot's first frame. */
  local: number;
  /** Source seconds. */
  src: number;
}

export interface TimelineClip {
  /** `<look>: <shot name>`. */
  name: string;
  clip: string;
  /** Timeline frames: where the clip sits between its cuts. */
  offset: number;
  duration: number;
  /** Frames into the shot the clip's first visible frame is (the shot begins where its dissolve does). */
  localStart: number;
  /** The shot's full length in seconds, half a dissolve into each neighbour. */
  length: number;
  map: [MapPoint, MapPoint];
  /** Reversed or not at speed 1, so it needs a time map. */
  retimed: boolean;
}

export interface Cut {
  fps: number;
  width: number;
  height: number;
  /** Frames. */
  duration: number;
  clips: TimelineClip[];
  /** Frames: each dissolve starts where the incoming shot does. */
  transitions: { offset: number; duration: number }[];
  markers: { frame: number; name: string }[];
}

/**
 * The edit on output frames. The ffmpeg build starts each shot at its bar,
 * dissolving in from the previous shot over `dissolve` seconds; here the cut
 * sits in the middle of that dissolve, so each clip shows from half a dissolve
 * into its shot.
 */
export function resolveCut(e: Edit, sources: Record<string, SourceInfo>): Cut {
  const fps = e.output.fps;
  const x = Math.round(e.dissolve * fps);
  const shots = layout(e);
  const begins = shots.map(s => Math.round(s.start * fps));
  const cuts = begins.map((b, i) => (i === 0 ? 0 : b + Math.floor(x / 2)));
  const last = shots.at(-1)!;
  const duration = Math.round((last.start + last.dur) * fps);

  const clips = shots.map((s, i): TimelineClip => {
    const source = sources[s.clip];
    if (!source) throw new Error(`shot ${i} uses clip "${s.clip}", which has no source`);
    const length = s.dur + e.dissolve;
    const { start, speed } = shotTiming({ ...s, dur: length }, source.duration);
    // ffmpeg reverses a span read 0.3 s past the shot's end
    const at = (l: number) => (s.reverse ? start + 0.3 + (length - l) * speed : start + l * speed);
    return {
      name: `${s.look}: ${s.name}`,
      clip: s.clip,
      offset: cuts[i],
      duration: (i + 1 < cuts.length ? cuts[i + 1] : duration) - cuts[i],
      localStart: cuts[i] - begins[i],
      length,
      map: [{ local: 0, src: at(0) }, { local: length, src: at(length) }],
      retimed: !!s.reverse || Math.abs(speed - 1) > 1e-3,
    };
  });

  const markers = shots.filter((s, i) => i === 0 || shots[i - 1].section !== s.section).map(s => ({ frame: begins[s.index], name: s.section }));

  return {
    fps,
    width: e.output.width,
    height: e.output.height,
    duration,
    clips,
    transitions: begins.slice(1).map(b => ({ offset: b, duration: x })),
    markers,
  };
}

interface Rate {
  num: number;
  den: number;
}

/** A frame rate as FCPXML writes it: whole, or an NTSC rate over 1001. */
function rate(fps: number): Rate {
  if (Math.abs(fps - Math.round(fps)) < 1e-3) return { num: Math.round(fps), den: 1 };
  const n = Math.round(fps * 1.001);
  if (Math.abs((n * 1000) / 1001 - fps) < 1e-3) return { num: n * 1000, den: 1001 };
  throw new Error(`frame rate ${fps} is neither whole nor NTSC`);
}

const frameDuration = (r: Rate) => `${r.den}/${r.num}s`;
const frames = (n: number, r: Rate) => (n === 0 ? "0s" : `${n * r.den}/${r.num}s`);
/** Seconds, on the nearest frame of `r`. */
const seconds = (t: number, r: Rate) => frames(Math.round((t * r.num) / r.den), r);
const esc = (t: string) => t.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** An audio file that plays from time 0 under the picture, such as the song's mix. */
export interface AudioTrack {
  name: string;
  path: string;
  duration: number;
}

/** The cut as an FCPXML document Resolve imports, with each audio file on its own lane under the picture. */
export function fcpxml(cut: Cut, opts: { title: string; sources: Record<string, SourceInfo>; audio?: AudioTrack[] }): string {
  const out = rate(cut.fps);
  const formats = new Map<string, string>([[frameDuration(out), "r1"]]);
  const resources = [`<format id="r1" frameDuration="${frameDuration(out)}" width="${cut.width}" height="${cut.height}"/>`];
  const assets = new Map<string, string>();
  let id = 1;
  const next = () => `r${++id}`;

  for (const name of new Set(cut.clips.map(c => c.clip))) {
    const s = opts.sources[name];
    const r = rate(s.fps);
    const key = frameDuration(r);
    if (!formats.has(key)) {
      const f = next();
      formats.set(key, f);
      resources.push(`<format id="${f}" frameDuration="${key}" width="${s.width}" height="${s.height}"/>`);
    }
    const a = next();
    assets.set(name, a);
    resources.push(
      `<asset id="${a}" name="${esc(name)}" start="0s" duration="${seconds(s.duration, r)}" hasVideo="1" videoSources="1" format="${formats.get(key)}">` +
        `<media-rep kind="original-media" src="${esc(pathToFileURL(s.path).href)}"/></asset>`,
    );
  }
  const under = (opts.audio ?? []).map((a, i) => {
    const ref = next();
    resources.push(
      `<asset id="${ref}" name="${esc(a.name)}" start="0s" duration="${seconds(a.duration, out)}" hasAudio="1" audioSources="1" audioChannels="2" audioRate="48000">` +
        `<media-rep kind="original-media" src="${esc(pathToFileURL(a.path).href)}"/></asset>`,
    );
    const dur = seconds(Math.min(a.duration, cut.duration / cut.fps), out);
    return `<asset-clip ref="${ref}" name="${esc(a.name)}" lane="${-(i + 1)}" offset="0s" start="0s" duration="${dur}" audioRole="music"/>`;
  });
  const dissolve = next();
  resources.push(`<effect id="${dissolve}" name="Cross Dissolve" uid="FxPlug:4731E73A-8DAC-4113-9A30-AE85B1761265"/>`);

  const story: string[] = [];
  cut.clips.forEach((c, i) => {
    if (i > 0) {
      const t = cut.transitions[i - 1];
      story.push(`<transition name="Cross Dissolve" offset="${frames(t.offset, out)}" duration="${frames(t.duration, out)}"><filter-video ref="${dissolve}" name="Cross Dissolve"/></transition>`);
    }
    const s = opts.sources[c.clip];
    const r = rate(s.fps);
    const attrs = `ref="${assets.get(c.clip)}" name="${esc(c.name)}" offset="${frames(c.offset, out)}" duration="${frames(c.duration, out)}"`;
    // A source at another rate plays in real time, as ffmpeg's framerate filter plays it.
    const conform = r.num !== out.num || r.den !== out.den ? `<conform-rate scaleEnabled="0"/>` : "";
    const fill = `<adjust-conform type="fill"/>`;
    if (!c.retimed) {
      story.push(`<asset-clip ${attrs} start="${seconds(c.map[0].src + c.localStart / cut.fps, r)}">${conform}${fill}</asset-clip>`);
    } else {
      const end = frames(Math.round(c.length * cut.fps), out);
      story.push(
        `<asset-clip ${attrs} start="${frames(c.localStart, out)}">${conform}` +
          `<timeMap><timept time="0s" value="${seconds(c.map[0].src, r)}" interp="linear"/><timept time="${end}" value="${seconds(c.map[1].src, r)}" interp="linear"/></timeMap>` +
          `${fill}</asset-clip>`,
      );
    }
  });

  const total = frames(cut.duration, out);
  const markers = cut.markers.map(m => `<marker start="${frames(m.frame, out)}" duration="${frames(1, out)}" value="${esc(m.name)}"/>`);

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE fcpxml>`,
    `<fcpxml version="1.9">`,
    `<resources>`,
    ...resources,
    `</resources>`,
    `<library><event name="${esc(opts.title)}"><project name="${esc(opts.title)}">`,
    `<sequence format="r1" duration="${total}" tcStart="0s" tcFormat="NDF">`,
    `<spine>`,
    // The picture rides a storyline over one gap the length of the song, so
    // the mix and the markers sit in timeline time.
    `<gap name="${esc(opts.title)}" offset="0s" start="0s" duration="${total}">`,
    `<spine lane="1" offset="0s">`,
    ...story,
    `</spine>`,
    ...under,
    ...markers,
    `</gap>`,
    `</spine>`,
    `</sequence>`,
    `</project></event></library>`,
    `</fcpxml>`,
    "",
  ].join("\n");
}
