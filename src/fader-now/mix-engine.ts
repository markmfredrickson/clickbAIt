/**
 * What the board should be set to, from which mix we're in and where we are.
 *
 * The board's state is built from layers, and what gets sent is always the
 * absolute result, never "3 more than what's there now", so jumping back or
 * looping over a move can't stack it:
 *
 *   playing   base + song settings + moves(beat)
 *   bailed    base + song settings + bail mix
 *   between   base + between mix
 *
 * In a layer, a level path (`ch.0.mix.lvl`) holds a dB change and an `on`
 * path holds the switch position itself. Levels add up and are clamped to the
 * fader's -90..+10 dB; for `on`, the topmost layer that sets it wins.
 *
 * Nudges (changes someone else made on the board) go to the layer that owns
 * the mix we're in: during a song the base, so a fix carries into every later
 * song; between songs the between mix; while bailed the bail mix. A mute
 * someone flips that the song or a move controls is held until the song ends.
 *
 * Every change of mix is a glide, timed in seconds. A mute can't fade, so
 * fading into one lowers the fader to the bottom, mutes, then puts the fader
 * back to its level behind the mute; fading out of one reverses that.
 *
 * Times are milliseconds on the caller's clock, passed in so this stays
 * deterministic. The engine never talks to the board: `update` returns the
 * sends, in the order they must go out.
 */

import type { MixerPath, MixerValue } from "../mixer/driver.js";

export type MixKind = "between" | "playing" | "bailed";

/** Level paths map to a dB change; `on` paths to the switch position. */
export type Layer = Record<MixerPath, MixerValue>;

export interface MixConfig {
  between: Layer;
  bail: Layer;
  /** Glide lengths in seconds. Going between songs uses the song's ring-out. */
  glideSec: { toPlaying: number; toBailed: number; fromBailed: number };
}

export interface SongMix {
  settings: Layer;
  moves: (beat: number) => Layer;
  ringOutSec: number;
}

/** What survives a restart. `applied` is each level's offset over its base. */
export interface MixSnapshot {
  base: Record<MixerPath, MixerValue>;
  between: Layer;
  bail: Layer;
  applied: Record<MixerPath, number>;
}

const FLOOR_DB = -90;
const CEILING_DB = 10;

/** A channel strip ("ch.0.mix") and its two controls. */
interface StripValue {
  lvl: number;
  on: boolean;
}

interface Glide {
  to: MixKind;
  startedAt: number;
  ms: number;
  from: Map<string, StripValue>;
  /** Strips someone took hold of mid-glide: they go straight to the target. */
  released: Set<string>;
}

const stripOf = (path: MixerPath) => path.slice(0, path.lastIndexOf("."));
const isOn = (path: MixerPath) => path.endsWith(".on");
const clampDb = (db: number) => Math.min(CEILING_DB, Math.max(FLOOR_DB, db));

function checkLayer(name: string, layer: Layer, base: Record<MixerPath, MixerValue>): void {
  for (const [path, v] of Object.entries(layer)) {
    if (!(path in base)) throw new Error(`${name}: "${path}" is not a parameter the board was read for`);
    if (isOn(path) ? typeof v !== "boolean" : typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error(`${name}: "${path}" has a ${typeof v} value`);
    }
  }
}

export class MixEngine {
  private base: Record<MixerPath, MixerValue>;
  private between: Layer;
  private bail: Layer;
  private readonly glideSec: MixConfig["glideSec"];
  private readonly strips: string[];
  private song: SongMix | null = null;
  /** Mutes someone flipped during the current song, held until it ends. */
  private holds: Layer = {};
  /** What the board currently has, as far as we know. */
  private board: Record<MixerPath, MixerValue>;
  private kind: MixKind | null = null;
  private beat = 0;
  private glide: Glide | null = null;

  constructor(board: Record<MixerPath, MixerValue>, config: MixConfig) {
    this.strips = [...new Set(Object.keys(board).map(stripOf))];
    for (const s of this.strips) {
      if (typeof board[`${s}.lvl`] !== "number" || typeof board[`${s}.on`] !== "boolean") {
        throw new Error(`board read for "${s}" needs both ${s}.lvl and ${s}.on`);
      }
    }
    checkLayer("between mix", config.between, board);
    checkLayer("bail mix", config.bail, board);
    this.base = { ...board };
    this.board = { ...board };
    this.between = { ...config.between };
    this.bail = { ...config.bail };
    this.glideSec = config.glideSec;
  }

  /** Rebuild after a restart: each base level is the board's minus what we'd applied. */
  static restore(snap: MixSnapshot, config: MixConfig, board: Record<MixerPath, MixerValue>): MixEngine {
    const e = new MixEngine(board, { ...config, between: snap.between, bail: snap.bail });
    for (const path of Object.keys(board)) {
      if (isOn(path)) {
        if (path in snap.base) e.base[path] = snap.base[path];
      } else {
        e.base[path] = (board[path] as number) - (snap.applied[path] ?? 0);
      }
    }
    return e;
  }

  snapshot(): MixSnapshot {
    const applied: Record<MixerPath, number> = {};
    for (const path of Object.keys(this.base)) {
      if (!isOn(path)) applied[path] = (this.board[path] as number) - (this.base[path] as number);
    }
    return { base: { ...this.base }, between: { ...this.between }, bail: { ...this.bail }, applied };
  }

  setSong(song: SongMix | null): void {
    if (song) checkLayer("song settings", song.settings, this.base);
    this.song = song;
    this.holds = {};
  }

  /** What the engine last sent (or read) for a path. */
  sent(path: MixerPath): MixerValue | undefined {
    return this.board[path];
  }

  /** The board was just read fresh (after a scene recall, say): that is the base now. */
  reread(board: Record<MixerPath, MixerValue>): void {
    for (const path of Object.keys(this.base)) {
      if (path in board) {
        this.base[path] = board[path];
        this.board[path] = board[path];
      }
    }
  }

  /** Someone else changed the board. File it under the layer that owns the mix. */
  boardChanged(path: MixerPath, value: MixerValue, _now: number): void {
    if (!(path in this.base)) return;
    this.board[path] = value;
    const kind = this.glide?.to ?? this.kind ?? "between";
    this.glide?.released.add(stripOf(path));

    const settings = this.song?.settings ?? {};
    const moves = kind === "playing" && this.song ? this.song.moves(this.beat) : {};

    if (isOn(path)) {
      if (kind === "between") this.between[path] = value;
      else if (kind === "bailed" && path in this.bail) this.bail[path] = value;
      else if (path in settings || path in moves) this.holds[path] = value;
      else this.base[path] = value;
      return;
    }

    const v = value as number;
    const base = this.base[path] as number;
    const delta = (layer: Layer) => (typeof layer[path] === "number" ? (layer[path] as number) : 0);
    if (kind === "between") this.between[path] = v - base;
    else if (kind === "bailed") this.bail[path] = v - base - delta(settings);
    else this.base[path] = v - delta(settings) - delta(moves);
  }

  /** Where we are now. Returns the sends to make, in the order they must go out. */
  update(kind: MixKind, beat: number, now: number): [MixerPath, MixerValue][] {
    if (this.kind === null) {
      this.kind = kind;
    } else if (kind !== this.kind || (this.glide && this.glide.to !== kind)) {
      const from = new Map(this.strips.map((s) => [s, this.output(s, now)] as const));
      const ms = this.glideMs(this.kind, kind);
      this.glide = ms > 0 ? { to: kind, startedAt: now, ms, from, released: new Set() } : null;
      if (kind === "between") this.holds = {};
      this.kind = kind;
    }
    this.beat = beat;
    if (this.glide && now - this.glide.startedAt >= this.glide.ms) this.glide = null;

    const sends: [MixerPath, MixerValue][] = [];
    for (const s of this.strips) {
      const want = this.output(s, now);
      const lvlPath = `${s}.lvl`;
      const onPath = `${s}.on`;
      const lvlChanged = want.lvl !== this.board[lvlPath];
      const onChanged = want.on !== this.board[onPath];
      // Muting goes out before the fader moves behind it; unmuting after the
      // fader is already where it should be.
      if (onChanged && !want.on) sends.push([onPath, false]);
      if (lvlChanged) sends.push([lvlPath, want.lvl]);
      if (onChanged && want.on) sends.push([onPath, true]);
      this.board[lvlPath] = want.lvl;
      this.board[onPath] = want.on;
    }
    return sends;
  }

  private glideMs(from: MixKind, to: MixKind): number {
    if (to === "between") return (this.song?.ringOutSec ?? 0) * 1000;
    if (to === "bailed") return this.glideSec.toBailed * 1000;
    return (from === "bailed" ? this.glideSec.fromBailed : this.glideSec.toPlaying) * 1000;
  }

  /** The strip's value in a mix, before any glide. */
  private target(strip: string, kind: MixKind): StripValue {
    const layers: Layer[] =
      kind === "between"
        ? [this.between]
        : kind === "bailed"
          ? [this.song?.settings ?? {}, this.bail, this.holds]
          : [this.song?.settings ?? {}, this.song ? this.song.moves(this.beat) : {}, this.holds];
    const lvlPath = `${strip}.lvl`;
    const onPath = `${strip}.on`;
    let lvl = this.base[lvlPath] as number;
    let on = this.base[onPath] as boolean;
    for (const layer of layers) {
      if (typeof layer[lvlPath] === "number") lvl += layer[lvlPath] as number;
      if (typeof layer[onPath] === "boolean") on = layer[onPath] as boolean;
    }
    return { lvl: clampDb(lvl), on };
  }

  /** The strip's value right now, partway through a glide if one is running. */
  private output(strip: string, now: number): StripValue {
    const kind = this.kind ?? "between";
    const to = this.target(strip, kind);
    const g = this.glide;
    if (!g || g.released.has(strip)) return to;
    const p = Math.min(1, Math.max(0, (now - g.startedAt) / g.ms));
    if (p >= 1) return to;
    const from = g.from.get(strip)!;
    if (!from.on && !to.on) return to; // silent either way
    // A muted end of the glide is heard as the bottom of the fader.
    const a = from.on ? from.lvl : FLOOR_DB;
    const b = to.on ? to.lvl : FLOOR_DB;
    return { lvl: a + (b - a) * p, on: true };
  }
}
