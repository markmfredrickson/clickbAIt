/**
 * A song's lights as a pure function of the beat: looks (static states) plus beat-keyed events.
 *
 *   look   cut to a look on the beat, or fade to it over `fade` beats
 *   flash  add a color to some lights, decaying exponentially
 *   tint   swing some lights to a color at their current brightness, decaying back
 *   blackout  knock every light out for `blackout` beats, flashes still decaying included
 *
 * A color is [r, g, b] or [r, g, b, uv], each 0..1. The state comes back with four channels on
 * every light, UV last (0 unless something sets it).
 *
 * The state at a beat is computed from the file alone (the last look event at or before it,
 * partway through any fade, plus flashes and tints still decaying), so a jump or re-entry lands
 * exactly and nothing has to be replayed.
 */

export type RGB = [number, number, number];
/** A color: red, green, blue and an optional UV level. */
export type Color = RGB | [number, number, number, number];
export type Look = Record<string, Color>;
/** Four channels, UV last: what lightsAt returns for every light. */
export type RGBU = [number, number, number, number];

export type LightEvent =
  | { beat: number; look: string; fade?: number }
  | { beat: number; flash: string[]; color: Color | "white"; level: number; decay: number }
  | { beat: number; tint: string[]; color: Color; level?: number; decay: number }
  | { beat: number; blackout: number };

export interface LightsFile {
  fixtures: string[];
  looks: Record<string, Look>;
  events: LightEvent[];
}

const BLACK: RGBU = [0, 0, 0, 0];
/** A decaying event has run out after this many decay constants. */
const DECAY_SPAN = 5;

// Events sorted once per file; the file itself is never mutated.
const sortedCache = new WeakMap<LightsFile, LightEvent[]>();
function sorted(file: LightsFile): LightEvent[] {
  let s = sortedCache.get(file);
  if (!s) {
    s = [...file.events].sort((x, y) => x.beat - y.beat);
    sortedCache.set(file, s);
  }
  return s;
}

/** Any color as four channels. White is visible white: it has no UV. */
const four = (c: Color | "white"): RGBU => (c === "white" ? [1, 1, 1, 0] : [c[0], c[1], c[2], c[3] ?? 0]);
const lerp = (a: RGBU, b: RGBU, t: number): RGBU => a.map((x, ch) => x + (b[ch] - x) * t) as RGBU;

function lookState(file: LightsFile, name: string | undefined): Record<string, RGBU> {
  const look = name ? file.looks[name] : undefined;
  if (name && !look) throw new Error(`lights: event names a look "${name}" the file doesn't have`);
  const out: Record<string, RGBU> = {};
  for (const f of file.fixtures) out[f] = look?.[f] ? four(look[f]) : [...BLACK];
  return out;
}

export function lightsAt(file: LightsFile, beat: number): Record<string, RGBU> {
  const events = sorted(file);
  for (const e of events) {
    if (e.beat > beat) break;
    if ("blackout" in e && beat < e.beat + e.blackout) return lookState(file, undefined);
  }
  // the base: the last look event at or before the beat, blended from the one before it if it fades
  let cur: { name: string; beat: number; fade: number } | null = null;
  let prev: string | undefined;
  for (const e of events) {
    if (e.beat > beat) break;
    if ("look" in e) {
      prev = cur?.name;
      cur = { name: e.look, beat: e.beat, fade: e.fade ?? 0 };
    }
  }
  let out = lookState(file, cur?.name);
  if (cur && cur.fade > 0 && beat < cur.beat + cur.fade) {
    const from = lookState(file, prev), t = (beat - cur.beat) / cur.fade;
    for (const f of file.fixtures) out[f] = lerp(from[f], out[f], t);
  }
  // decaying events on top, in time order
  for (const e of events) {
    if (e.beat > beat) break;
    if ("look" in e || "blackout" in e) continue;
    const age = beat - e.beat;
    if (age >= e.decay * DECAY_SPAN) continue;
    const v = Math.exp(-age / e.decay);
    if ("flash" in e) {
      const c = four(e.color);
      for (const f of e.flash) if (out[f]) out[f] = out[f].map((x, ch) => Math.min(1, x + c[ch] * e.level * v)) as RGBU;
    } else {
      for (const f of e.tint) {
        const base = out[f];
        if (!base) continue;
        const lvl = Math.max(...base);
        if (lvl <= 0) continue; // a tint never lights a dark light
        const k = Math.min(1, (e.level ?? 1) * v);
        const c = four(e.color);
        const m = base.map((x, ch) => x + (c[ch] * lvl - x) * k), mx = Math.max(...m, 1e-9);
        out[f] = m.map((x) => (x / mx) * lvl) as RGBU; // hold the brightness through the swing
      }
    }
  }
  return out;
}
