/**
 * A song's crop as an ffmpeg filter, from its gig.json crop and, for a crop
 * that follows the band, the measured camera motion and people.
 */

import { readFileSync } from "node:fs";
import { type CropKey, pathFilter, perspectiveFilter } from "./crop.js";
import { cropPath, type CurveCrop, type PeopleSample } from "./follow.js";
import { frameRate } from "./media.js";
import type { MotionSample } from "./motion.js";

/** The crop's filter: keyed boxes, or curves sampled twice a second (from the camera's motion when they follow it). */
export function cropFilter(phone: string, c: CropKey[] | CurveCrop, span: { start: number; end: number }, files: { motion?: string; people?: string } = {}): string {
  const fps = frameRate(phone);
  const { start, end } = span;
  if (Array.isArray(c)) return perspectiveFilter(c, { start, fps });
  const samples: MotionSample[] | null = files.motion ? JSON.parse(readFileSync(files.motion, "utf8")).samples : null;
  const people: PeopleSample[] | null = files.people ? JSON.parse(readFileSync(files.people, "utf8")).samples : null;
  const times = samples ? samples.map((s) => s.t) : Array.from({ length: Math.floor((end - start) * 2) + 1 }, (_, i) => start + i / 2);
  return pathFilter(cropPath(times, samples, people, c, 1920, 1080), { start, fps });
}
