/**
 * Rig config (`default.json`) — the band's REAPER routing and record-track
 * layout. This is rig-level, NOT per-song: one config applies to every
 * generated project. It captures the hardware-specific parts of the RPP that
 * build-rpp otherwise can't know (hardware outputs, record inputs, the
 * record→playback round trip), keeping them as inert, editable data rather
 * than a binary template project.
 *
 * The encodings here were decoded from a real REAPER project and cross-checked
 * against the band's X32 scene (see the reference notes). The one field not yet
 * confirmed against hardware is the record-INPUT number — see recInputField.
 */

import { z } from "zod";

/** A hardware output/input target: a mono channel or the first channel of a
 *  stereo pair. Channel numbers are physical (1-based). */
const HwSchema = z.union([
  z.object({ mono: z.number().int().positive() }),
  z.object({ stereo: z.number().int().positive() }),
]);
export type Hw = z.infer<typeof HwSchema>;

/** Routing for one of the generated tracks (click / cues / stems). */
const RouteSchema = z.object({
  /** Send to master. false = the track only reaches its hwout. */
  master: z.boolean().default(true),
  /** Hardware output assignment (bypasses/adds to master). */
  hwout: HwSchema.optional(),
  /** Mute by default (stems ship muted so you unmute what you need). */
  muted: z.boolean().default(false),
  /** Linear gain (1 = unity, the default). Balance is set on the mixer. */
  gain: z.number().positive().default(1),
});
export type Route = z.infer<typeof RouteSchema>;

/** A channel: mono (one number) or a stereo pair (first + second). */
const ChannelSchema = z.union([
  z.number().int().positive(),
  z.tuple([z.number().int().positive(), z.number().int().positive()]),
]);

/** An explicit record track (used for the drum tracks). */
const RecordTrackSchema = z.object({
  name: z.string(),
  channel: ChannelSchema,
  arm: z.boolean().default(true),
  /** Play back out to the same channel it records from (virtual soundcheck). */
  roundTrip: z.boolean().default(true),
});

export const RigSchema = z.object({
  /** Master hardware output (MASTERHWOUT). */
  master: z.object({ hwout: HwSchema }).optional(),
  generated: z
    .object({
      click: RouteSchema.optional(),
      cues: RouteSchema.optional(),
      stems: RouteSchema.optional(),
    })
    .optional(),
  /** A contiguous block of N mono round-trip record tracks (card 1..N),
   *  named where known and reserved (bare) otherwise, so adding an input
   *  later is a rename, not a re-layout. */
  bandBlock: z
    .object({
      channels: z.number().int().positive(),
      arm: z.boolean().default(true),
      roundTrip: z.boolean().default(true),
      names: z.record(z.string(), z.string()).default({}),
    })
    .optional(),
  /** Explicit extra record tracks (the electronic-kit aux feeds). */
  drums: z.array(RecordTrackSchema).default([]),
});
export type Rig = z.infer<typeof RigSchema>;

/**
 * REAPER's HWOUT/MASTERHWOUT first field.
 * - stereo pair at physical output P (1-based) → P − 1
 * - mono at physical output P → 1024 + (P − 1)
 * Verified against the my-favorite-mistake RPP (master 17/18 → 16, cue 19 →
 * 1042, click 20 → 1043).
 */
export function hwoutField(h: Hw): number {
  if ("mono" in h) return 1024 + (h.mono - 1);
  return h.stereo - 1;
}

/**
 * REAPER's record-input field (2nd field of the REC line).
 * - mono input N (1-based) → N − 1
 * - stereo pair starting at N → 1024 + (N − 1)
 * Mirrors the HWOUT flag pattern. NOT YET confirmed against X32 hardware —
 * verify one armed input on first open; a mismatch is a one-line fix here.
 */
export function recInputField(channel: number | [number, number]): number {
  if (Array.isArray(channel)) return 1024 + (channel[0] - 1);
  return channel - 1;
}

/** A resolved record-track spec ready for build-rpp to emit. */
export interface RecordTrackSpec {
  name: string;
  /** REC input field. */
  recInput: number;
  /** HWOUT field for playback (round trip), or undefined for no playback out. */
  hwout: number | undefined;
  arm: boolean;
  /** 1 = mono, 2 = stereo. */
  nchan: number;
}

/** The HWOUT that plays a recorded channel back out to the same channel. */
function roundTripHwout(channel: number | [number, number]): number {
  return Array.isArray(channel)
    ? hwoutField({ stereo: channel[0] })
    : hwoutField({ mono: channel });
}

/** Expand the band block into N mono round-trip record tracks. */
export function expandBandBlock(bb: NonNullable<Rig["bandBlock"]>): RecordTrackSpec[] {
  const specs: RecordTrackSpec[] = [];
  for (let ch = 1; ch <= bb.channels; ch++) {
    const label = bb.names[String(ch)];
    const num = String(ch).padStart(2, "0");
    specs.push({
      name: label ? `X32 CH ${num} (${label})` : `X32 CH ${num}`,
      recInput: recInputField(ch),
      hwout: bb.roundTrip ? roundTripHwout(ch) : undefined,
      arm: bb.arm,
      nchan: 1,
    });
  }
  return specs;
}

/** Resolve every record track (band block + explicit drums) for build-rpp. */
export function recordTrackSpecs(rig: Rig): RecordTrackSpec[] {
  const specs: RecordTrackSpec[] = [];
  if (rig.bandBlock) specs.push(...expandBandBlock(rig.bandBlock));
  for (const d of rig.drums) {
    specs.push({
      name: d.name,
      recInput: recInputField(d.channel),
      hwout: d.roundTrip ? roundTripHwout(d.channel) : undefined,
      arm: d.arm,
      nchan: Array.isArray(d.channel) ? 2 : 1,
    });
  }
  return specs;
}
