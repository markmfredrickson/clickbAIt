/**
 * Edited-footage scenes: a song's video cut from stock and archive clips, as data.
 *
 * A generative scene (p5, `<slug>.scene.js`) draws every frame. An edited scene is
 * a shot list instead: which clip, which seconds, how many bars, which look. It
 * lives in `visuals/edit.json` beside the manifest and renders with ffmpeg.
 *
 * The build is a nested wireit package, `visuals/package.json`, generated from
 * the edit: one task per shot, so changing a shot re-renders that shot only
 * (wireit does the caching), then `assemble` joins them. `split` writes one
 * file per shot (`visuals/shots/NNN.json`) holding everything that shot's render
 * reads, so wireit sees exactly which shots changed.
 */

/** What a shot is, for the cutting rules and the per-kind treatment. */
export type ShotKind = "road" | "land" | "sky" | "close";

export interface ShotSpec {
  /** A key into `clips`. */
  clip: string;
  bars: number;
  kind: ShotKind;
  /** Source seconds the usable part starts and ends at (default: the whole clip). */
  from?: number;
  to?: number;
  /** Play from `from` (an entrance, a drive-over) instead of the middle of the usable part. */
  anchor?: "start" | "center";
  /** Fixed playback speed; otherwise sky shots speed up, short shots slow down. */
  speed?: number;
  night?: boolean;
  reverse?: boolean;
  /** Ken Burns direction for non-sky shots (default: in or out, fixed per shot name). */
  push?: "in" | "out" | "none";
  /** Override the section's look. */
  look?: string;
}

export interface EditSection {
  name: string;
  look: string;
  shots: ShotSpec[];
}

/** Who made a clip or sound and under what license: what the credits read. */
export interface Provenance {
  by?: string;
  license?: string;
  /** The page it came from. */
  url?: string;
}

/** A clip from the song's `footage/footage.json`, its file relative to `visuals/`. */
export interface Clip extends Provenance {
  file: string;
}

export interface SoundCue extends Provenance {
  file: string;
  /** Edit seconds the sound starts at. */
  at: number;
  /** Source seconds to play, and how long (a looped sound repeats [from, to) for `dur`). */
  from?: number;
  to?: number;
  dur?: number;
  gainDb?: number;
  fadeIn?: number;
  fadeOut?: number;
  loop?: boolean;
  lowpass?: number;
}

export interface Edit {
  bpm: number;
  beatsPerBar: number;
  preRollBars: number;
  songBars: number;
  ringOutBars: number;
  output: { width: number; height: number; fps: number };
  /** Dissolve length between shots, seconds. */
  dissolve: number;
  /** Filters over the whole assembled cut. */
  film: string[];
  /** Section looks: ffmpeg filters applied to each shot of that look. `{gamma}` is the shot's brightness correction. */
  looks: Record<string, string[]>;
  /** A look's typical saturation (signalstats SATAVG); a washed-out shot is lifted toward it. */
  saturation?: Record<string, number>;
  /** Filled from `footage/footage.json` when the edit is read; not written in edit.json. */
  clips: Record<string, Clip>;
  sections: EditSection[];
  /** Sound effects baked into the video's audio (the car), in edit seconds. */
  sounds?: SoundCue[];
}

export interface PlacedShot extends ShotSpec {
  index: number;
  /** The clip, then `clip.2`, `clip.3` for its later uses: a shot's file and task name. */
  name: string;
  section: string;
  look: string;
  startBar: number;
  /** Edit seconds. */
  start: number;
  dur: number;
}

/** Bar length in seconds. */
export function barSeconds(e: Pick<Edit, "bpm" | "beatsPerBar">): number {
  return (60 / e.bpm) * e.beatsPerBar;
}

/** Every shot on the bar grid, in order. The bars must fill preroll + song + ring-out. */
/** The edit starts at the show track's time 0, so its preroll must be the
 *  manifest's preRollBars; a mismatch would put the picture off the song. */
export function prerollProblem(e: Pick<Edit, "preRollBars">, manifestPreRollBars: number): string | undefined {
  if (e.preRollBars === manifestPreRollBars) return undefined;
  return `edit.json has preRollBars ${e.preRollBars} but the manifest has ${manifestPreRollBars}; the picture would be ${Math.abs(e.preRollBars - manifestPreRollBars)} bar(s) off the song`;
}

export function layout(e: Edit): PlacedShot[] {
  const bar = barSeconds(e);
  const shots: PlacedShot[] = [];
  const uses = new Map<string, number>();
  let at = 0;
  for (const sec of e.sections) {
    for (const s of sec.shots) {
      const n = (uses.get(s.clip) ?? 0) + 1;
      uses.set(s.clip, n);
      shots.push({ ...s, index: shots.length, name: n === 1 ? s.clip : `${s.clip}.${n}`, section: sec.name, look: s.look ?? sec.look, startBar: at, start: at * bar, dur: s.bars * bar });
      at += s.bars;
    }
  }
  const want = e.preRollBars + e.songBars + e.ringOutBars;
  if (Math.abs(at - want) > 1e-6) throw new Error(`the edit is ${at} bars, want ${want} (preroll ${e.preRollBars} + song ${e.songBars} + ring-out ${e.ringOutBars})`);
  return shots;
}

/** A fixed Ken Burns direction per shot name, so the pushes alternate without depending on position. */
function defaultPush(name: string): "in" | "out" {
  let sum = 0;
  for (const c of name) sum += c.charCodeAt(0);
  return sum % 2 ? "in" : "out";
}

/** One JSON file per shot, holding everything its render reads (so its wireit task sees every change). */
export function shotFiles(e: Edit): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of layout(e)) {
    const clip = e.clips[s.clip];
    if (!clip) throw new Error(`shot ${s.index} uses clip "${s.clip}", which isn't in clips`);
    const look = e.looks[s.look];
    if (!look) throw new Error(`shot ${s.index} uses look "${s.look}", which isn't in looks`);
    // Position (index, start) stays out, so inserting a shot leaves the others' files alone.
    const shot = {
      clip: s.clip,
      file: clip.file,
      kind: s.kind,
      from: s.from,
      to: s.to,
      anchor: s.anchor,
      speed: s.speed,
      night: s.night,
      reverse: s.reverse,
      push: s.kind === "sky" ? "none" : (s.push ?? defaultPush(s.name)),
      look,
      saturation: e.saturation?.[s.look],
      // a shot runs half a dissolve into each neighbour
      dur: s.dur + e.dissolve,
      width: e.output.width,
      height: e.output.height,
      fps: e.output.fps,
    };
    out[`shots/${s.name}.json`] = JSON.stringify(shot, null, 1) + "\n";
  }
  return out;
}

/**
 * The cutting rules Mark set, as warnings: close-ups (car, driver, mirror) never
 * back to back; roads alternate with landscape (a close-up between two roads
 * doesn't count as a break); landscape, sky and close-up footage isn't reused,
 * while roads may repeat.
 */
export function checkRules(shots: PlacedShot[]): string[] {
  const warn: string[] = [];
  for (let i = 1; i < shots.length; i++) {
    if (shots[i].kind === "close" && shots[i - 1].kind === "close") warn.push(`close-ups back to back: shot ${i - 1} (${shots[i - 1].clip}) and shot ${i} (${shots[i].clip})`);
  }
  const scenery = shots.filter(s => s.kind !== "close");
  for (let i = 1; i < scenery.length; i++) {
    if (scenery[i].kind === "road" && scenery[i - 1].kind === "road") warn.push(`road after road: shot ${scenery[i - 1].index} (${scenery[i - 1].clip}) and shot ${scenery[i].index} (${scenery[i].clip})`);
  }
  const uses = new Map<string, number>();
  for (const s of shots) if (s.kind === "land" || s.kind === "sky") uses.set(s.clip, (uses.get(s.clip) ?? 0) + 1);
  for (const [clip, n] of uses) if (n > 1) warn.push(`${clip} is used ${n} times`);
  return warn;
}

/** Who to thank, in order of first appearance: each used clip's and sound's maker once. */
export function credits(e: Edit): { heading: string; names: string[] }[] {
  const footage = [...new Set(layout(e).map(s => e.clips[s.clip]?.by).filter((b): b is string => !!b))];
  const sound = [...new Set((e.sounds ?? []).map(c => c.by).filter((b): b is string => !!b))];
  return [
    ...(footage.length ? [{ heading: "Footage", names: footage }] : []),
    ...(sound.length ? [{ heading: "Sound", names: sound }] : []),
  ];
}

/** The nested wireit package that builds an edit: one task per shot and the credits, then assemble. */
export function visualsPackage(e: Edit, opts: { rel: string; slug: string; audio: string }): Record<string, unknown> {
  const cli = `npx tsx ${opts.rel}/src/visuals/edit-cli.ts`;
  const wireit: Record<string, unknown> = {};
  const shots = layout(e);
  for (const s of shots) {
    wireit[`shot-${s.name}`] = {
      command: `${cli} shot shots/${s.name}.json`,
      files: [`shots/${s.name}.json`, e.clips[s.clip].file],
      output: [`.shots/${s.name}.mp4`],
    };
  }
  wireit.credits = {
    command: `${cli} credits credits.json`,
    files: ["credits.json"],
    output: [".shots/credits.mp4"],
  };
  const soundFiles = [...new Set((e.sounds ?? []).map(c => c.file))];
  wireit.assemble = {
    command: `${cli} assemble edit.json`,
    files: [".shots/*.mp4", "edit.json", opts.audio, ...soundFiles],
    output: [`${opts.slug}.visuals.mp4`, `${opts.slug}.visuals-review.mp4`],
    dependencies: [...shots.map(s => `shot-${s.name}`), "credits"],
  };
  return {
    name: `${opts.slug}-visuals`,
    private: true,
    scripts: { assemble: "wireit" },
    wireit,
  };
}

/**
 * Where a shot starts in its source and how fast it plays. Sky speeds up by a
 * whole number (blended frames, so clouds don't jump); a source too short for
 * the shot slows down to fill it. A shot plays from the middle of its usable
 * part unless anchored at the start.
 */
export function shotTiming(
  s: { kind: ShotKind; dur: number; from?: number; to?: number; speed?: number; night?: boolean; anchor?: "start" | "center" },
  sourceDur: number,
): { start: number; speed: number } {
  const a = s.from ?? 0;
  const len = Math.min(sourceDur, s.to ?? sourceDur) - a - 0.05; // stay clear of the last frame
  let speed = s.speed ?? (s.kind === "sky" && !s.night ? Math.max(1, Math.min(3, Math.floor(len / s.dur))) : 1);
  if (len / s.dur < speed) speed = len / s.dur;
  const start = s.anchor === "start" ? a : a + Math.max(0, (len - s.dur * speed) / 2);
  return { start: Math.round(start * 1000) / 1000, speed };
}
