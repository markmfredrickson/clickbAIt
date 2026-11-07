/**
 * A song's lights as a pure function of the beat: looks (static states) plus beat-keyed events.
 *
 *   look   cut to a look on the beat, or fade to it over `fade` beats
 *   flash  add a color to some lights, decaying exponentially
 *   tint   swing some lights to a color at their current brightness, decaying back
 *   blackout  knock every light out for `blackout` beats, flashes still decaying included
 *   dimmer scale some lights' look to a fraction (`to`), fading there over `fade` beats from wherever
 *          the level stands; it holds until the next dimmer event on that light. Flashes and tints
 *          ride on top of it at full strength.
 *
 * The file carries its format version in `schema`; `parseLights` checks it and every event.
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

/** The light file format this code reads and writes. */
export const LIGHTS_SCHEMA = "clickbait/lights@1";

export type LightEvent =
  | { beat: number; look: string; fade?: number }
  | { beat: number; flash: string[]; color: Color | "white"; level: number; decay: number }
  | { beat: number; tint: string[]; color: Color; level?: number; decay: number }
  | { beat: number; blackout: number }
  | { beat: number; dimmer: string[]; to: number; fade?: number };

export interface LightsFile {
  schema: typeof LIGHTS_SCHEMA;
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
  for (const f of file.fixtures) {
    const lvl = dimmerAt(events, f, beat);
    if (lvl !== 1) out[f] = out[f].map((x) => x * lvl) as RGBU;
  }
  // decaying events on top, in time order
  for (const e of events) {
    if (e.beat > beat) break;
    if ("look" in e || "blackout" in e || "dimmer" in e) continue;
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

/** A light's dimmer level at a beat: 1 until a dimmer event names it, each fade starting from the level then. */
function dimmerAt(events: LightEvent[], fixture: string, beat: number): number {
  let from = 1, to = 1, start = -Infinity, fade = 0;
  const at = (b: number) => (fade > 0 && b < start + fade ? from + (to - from) * ((b - start) / fade) : to);
  for (const e of events) {
    if (e.beat > beat) break;
    if (!("dimmer" in e) || !e.dimmer.includes(fixture)) continue;
    from = at(e.beat);
    to = e.to;
    start = e.beat;
    fade = e.fade ?? 0;
  }
  return at(beat);
}

/**
 * A light file from parsed JSON, checked: the schema version, and every event a known kind naming
 * looks and lights the file has. Throws with a message saying what is wrong.
 */
export function parseLights(raw: unknown): LightsFile {
  const fail = (msg: string): never => {
    throw new Error(`lights: ${msg}`);
  };
  const isNum = (x: unknown) => typeof x === "number" && Number.isFinite(x);
  const isColor = (x: unknown) => Array.isArray(x) && (x.length === 3 || x.length === 4) && x.every(isNum);
  if (!raw || typeof raw !== "object") fail("the file is not a JSON object");
  const file = raw as Record<string, unknown>;
  if (file.schema !== LIGHTS_SCHEMA) {
    fail(file.schema === undefined ? `the file has no schema; this reader reads "${LIGHTS_SCHEMA}"` : `the file's schema is "${String(file.schema)}"; this reader reads "${LIGHTS_SCHEMA}"`);
  }
  const fixtures = file.fixtures as string[];
  if (!Array.isArray(fixtures) || !fixtures.every((f) => typeof f === "string")) fail("fixtures must be a list of light names");
  const looks = file.looks as Record<string, unknown>;
  if (!looks || typeof looks !== "object") fail("looks must be an object");
  for (const [name, look] of Object.entries(looks)) {
    if (!look || typeof look !== "object") fail(`look "${name}" must be an object`);
    for (const [f, c] of Object.entries(look as object)) {
      if (!fixtures.includes(f)) fail(`look "${name}" names a light "${f}" the file doesn't have`);
      if (!isColor(c)) fail(`look "${name}" gives "${f}" a color that isn't [r, g, b] or [r, g, b, uv]`);
    }
  }
  if (!Array.isArray(file.events)) fail("events must be a list");
  const lights = (e: Record<string, unknown>, key: string) => {
    const xs = e[key];
    if (!Array.isArray(xs)) fail(`event at beat ${e.beat}: ${key} must be a list of lights`);
    for (const f of xs as unknown[]) if (!fixtures.includes(f as string)) fail(`event at beat ${e.beat} names a light "${String(f)}" the file doesn't have`);
  };
  const kinds = ["look", "flash", "tint", "blackout", "dimmer"];
  for (const e of file.events as Record<string, unknown>[]) {
    if (!e || typeof e !== "object" || !isNum(e.beat)) fail(`every event needs a numeric beat (got ${JSON.stringify(e)})`);
    const kind = kinds.filter((k) => k in e);
    if (kind.length !== 1) fail(`event at beat ${e.beat} is not one this reader knows: ${JSON.stringify(e)}`);
    const bad = (what: string): never => fail(`event at beat ${e.beat}: ${what}`);
    switch (kind[0]) {
      case "look":
        if (typeof e.look !== "string" || !(e.look in looks)) bad(`it names a look "${String(e.look)}" the file doesn't have`);
        if (e.fade !== undefined && !isNum(e.fade)) bad("fade must be a number of beats");
        break;
      case "flash":
        lights(e, "flash");
        if (e.color !== "white" && !isColor(e.color)) bad("a flash color must be \"white\" or [r, g, b(, uv)]");
        if (!isNum(e.level) || !isNum(e.decay)) bad("a flash needs a level and a decay");
        break;
      case "tint":
        lights(e, "tint");
        if (!isColor(e.color) || !isNum(e.decay)) bad("a tint needs a color and a decay");
        if (e.level !== undefined && !isNum(e.level)) bad("level must be a number");
        break;
      case "blackout":
        if (!isNum(e.blackout)) bad("blackout must be a number of beats");
        break;
      case "dimmer":
        lights(e, "dimmer");
        if (!isNum(e.to)) bad("a dimmer needs a level to go to");
        if (e.fade !== undefined && !isNum(e.fade)) bad("fade must be a number of beats");
        break;
    }
  }
  return raw as LightsFile;
}
