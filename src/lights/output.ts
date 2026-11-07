/**
 * The relay's Art-Net output.
 *
 * Two ways to drive it: `play` the song's lights at REAPER's beat, or `hold` a fixed look.
 * REAPER reports the position a few times a second; `play` carries the beat forward between
 * reports at the tempo the last two implied, so fades and flashes run smoothly. A frame goes out on
 * every call where the lights changed, and an unchanged frame is repeated at a slow keep-alive rate
 * so a node that missed a packet catches up.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { artDmxPacket, DmxEncoder, type Patch } from "./artnet.js";
import { lightsAt, type LightsFile, type Look } from "./events.js";

export interface OutputOptions {
  patch: Patch;
  /** Played in place of a song that has no light file. */
  fallback: Look;
  send: (packet: Buffer) => void;
  universe?: number;
  /** How often an unchanged frame is repeated (default 250 ms). */
  keepaliveMs?: number;
}

/** Longest stretch the beat is carried forward without a report from REAPER. */
const MAX_EXTRAPOLATE_MS = 500;
/** Tempo estimates outside this range (beats per ms) come from a jump, not playback. */
const MAX_RATE = 12 / 1000; // 720 bpm

export class LightsOutput {
  private encoder: DmxEncoder;
  private song: LightsFile | null = null;
  private last: { beat: number; at: number } | null = null;
  private rate = 0;
  private sentFrame: Uint8Array | null = null;
  private sentAt = -Infinity;
  private sequence = 0;
  constructor(private opts: OutputOptions) {
    this.encoder = new DmxEncoder(opts.patch);
  }

  setSong(song: LightsFile | null): void {
    this.song = song;
  }

  /** The song's lights at REAPER's last report (`beat` at `beatAt`), carried forward to now. */
  play(beat: number, beatAt: number, nowMs: number): void {
    if (!this.last || beatAt !== this.last.at) {
      if (this.last && beatAt > this.last.at) {
        const r = (beat - this.last.beat) / (beatAt - this.last.at);
        // a jump or a loop wrap gives a nonsense tempo; keep the old one rather than learn it
        if (r > 0 && r < MAX_RATE) this.rate = r;
      }
      this.last = { beat, at: beatAt };
    }
    const ahead = Math.min(Math.max(0, nowMs - this.last.at), MAX_EXTRAPOLATE_MS);
    const now = this.last.beat + ahead * this.rate;
    this.emit(this.song ? lightsAt(this.song, now) : this.opts.fallback, nowMs);
  }

  /** A fixed look. The next `play` starts without the old tempo. */
  hold(look: Look, nowMs: number): void {
    this.last = null;
    this.rate = 0;
    this.emit(look, nowMs);
  }

  private emit(levels: Look, nowMs: number): void {
    const frame = this.encoder.encode(levels);
    const same = this.sentFrame !== null && frame.every((v, i) => v === this.sentFrame![i]);
    if (same && nowMs - this.sentAt < (this.opts.keepaliveMs ?? 250)) return;
    this.sequence = (this.sequence % 255) + 1; // Art-Net sequence runs 1..255; 0 means "unused"
    this.opts.send(artDmxPacket(frame, { universe: this.opts.universe ?? 0, sequence: this.sequence }));
    this.sentFrame = frame;
    this.sentAt = nowMs;
  }
}

export interface LightsRig {
  artnet: { host: string; port: number; universe: number };
  patch: Patch;
  /** The fixed looks: house (no session), standby (between songs) and busk (bailed). */
  looks: { halted: Look; standby: Look; busk: Look };
}

/** Reads a rig file: the patch, where Art-Net goes, and the fixed looks (paths relative to it). */
export function loadLightsRig(path: string): LightsRig {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const dir = dirname(path);
  const look = (key: "halted" | "standby" | "busk"): Look => {
    const file = raw.looks?.[key];
    if (typeof file !== "string") throw new Error(`lights rig ${path}: looks.${key} must name a look file`);
    return JSON.parse(readFileSync(resolve(dir, file), "utf8"));
  };
  return {
    artnet: { host: raw.artnet?.host ?? "127.0.0.1", port: raw.artnet?.port ?? 6454, universe: raw.artnet?.universe ?? 0 },
    patch: raw.patch,
    looks: { halted: look("halted"), standby: look("standby"), busk: look("busk") },
  };
}
