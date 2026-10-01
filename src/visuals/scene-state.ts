/**
 * What a scene sees on each frame: where the song is (from the shared
 * project-time curve and `songPosition`) and every stem's features at any beat.
 *
 * Pure and keyed by time alone, so an offline render, a live preview and a
 * REAPER video track all show the same frame for the same moment.
 */

import { Curve, type Anchor } from "../core/curve.js";
import { songPosition, type MeteredSection } from "../teleprompter/position.js";
import type { NormalFeatures } from "./beat-grid.js";

/** The project-time curve, as `lyrics-display.json` carries it. */
export interface SceneTiming {
  curve: Anchor[];
}

/** A section as `rows.json` carries it, in beats. */
export interface SceneSection {
  name: string;
  start: number;
  end: number;
  bars: number;
  beatsPerBar: number;
  barBeats?: number[];
}

export type Feature = "loud" | "onset" | "bright" | "low" | "mid" | "high";
const FEATURES: readonly Feature[] = ["loud", "onset", "bright", "low", "mid", "high"];

/** `<slug>.beat-features.json`. */
export interface SceneFeatures {
  startBeat: number;
  stepsPerBeat: number;
  stems: Record<string, Pick<NormalFeatures, Feature>>;
}

export interface SceneState {
  /** Project seconds. */
  t: number;
  beat: number;
  /** How far through the current beat, 0..1. */
  phase: number;
  countIn: boolean;
  /** 1-based bar within the section, and beat within the bar. */
  bar: number;
  beatInBar: number;
  /** 1-based bar of the song, as REAPER counts it. */
  measure: number;
  section: { index: number; name: string; beat: number; progress: number } | null;
  next: { name: string; inBeats: number } | null;
  /** A stem's feature (0..1) at `beat`, or now. */
  f(stem: string, feature: Feature, beat?: number): number;
}

export interface SceneClock {
  at(t: number): SceneState;
}

export function sceneClock(timing: SceneTiming, sections: readonly SceneSection[], features?: SceneFeatures): SceneClock {
  const curve = new Curve(timing.curve);
  const metered: MeteredSection[] = sections.map((s) => ({
    startBeat: s.start,
    bars: s.bars,
    beatsPerBar: s.beatsPerBar,
    ...(s.barBeats ? { barBeats: s.barBeats } : {}),
  }));
  const countInBeatsPerBar = sections[0]?.beatsPerBar ?? 4;

  const read = (stem: string, feature: Feature, beat: number): number => {
    const st = features?.stems[stem];
    if (!st) throw new Error(`scene asked for stem "${stem}"; this song has ${Object.keys(features?.stems ?? {}).join(", ") || "no stems"}`);
    if (!FEATURES.includes(feature)) throw new Error(`scene asked for feature "${feature}"; features are ${FEATURES.join(", ")}`);
    const i = Math.round((beat - features!.startBeat) * features!.stepsPerBeat);
    return st[feature][i] ?? 0;
  };

  return {
    at(t) {
      const beat = curve.toBeat(t);
      const pos = songPosition(metered, beat, countInBeatsPerBar);
      const s = pos.section >= 0 ? sections[pos.section] : undefined;
      const following = sections[pos.section + 1];
      return {
        t,
        beat,
        phase: beat - Math.floor(beat),
        countIn: pos.section < 0,
        bar: pos.bar,
        beatInBar: pos.beat,
        measure: pos.measure,
        section: s ? { index: pos.section, name: s.name, beat: beat - s.start, progress: (beat - s.start) / (s.end - s.start) } : null,
        next: following ? { name: following.name, inBeats: following.start - beat } : null,
        f: (stem, feature, b = beat) => read(stem, feature, b),
      };
    },
  };
}
