/**
 * Where a drum stem goes silent. The drum-stem beat tracker invents a pulse
 * through silence (a dropped bar after a chorus, a drumless intro), so the
 * beat merge (`unify-beats.ts`) takes the full-mix beats inside these spans.
 *
 * Loudness is the RMS of short frames in dB. A frame is silent when it sits
 * `floorDb` below the stem's 90th-percentile frame, which is the level of the
 * drums when they play. A silence is a run of silent frames lasting at least
 * `minSeconds`; the 1 s default is shorter than a bar at any tempo we play, so
 * a single dropped bar is caught, and a one-beat rest is not.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const BIN = resolve(import.meta.dirname, "../../.claude/skills/clickbait/bin/clickbait-audio");

export interface SilenceOptions {
  /** dB below the stem's 90th-percentile frame that counts as silent. Default -35. */
  floorDb?: number;
  /** Shortest silence reported, in seconds. Default 1. */
  minSeconds?: number;
  /** Frame length in seconds. Default 0.05. */
  frameSeconds?: number;
}

/** Silent spans as [start, end) in seconds. */
export function silentSpans(samples: Float32Array, sampleRate: number, opts: SilenceOptions = {}): Array<[number, number]> {
  const floorDb = opts.floorDb ?? -35;
  const minSeconds = opts.minSeconds ?? 1;
  const hop = Math.max(1, Math.round((opts.frameSeconds ?? 0.05) * sampleRate));
  const frames = Math.ceil(samples.length / hop);
  if (frames === 0) return [];

  const db = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const end = Math.min(samples.length, (f + 1) * hop);
    for (let i = f * hop; i < end; i++) sum += samples[i] * samples[i];
    db[f] = 10 * Math.log10(sum / (end - f * hop) + 1e-12);
  }
  const sorted = [...db].sort((a, b) => a - b);
  const threshold = sorted[Math.floor(0.9 * (sorted.length - 1))] + floorDb;

  const spans: Array<[number, number]> = [];
  const total = samples.length / sampleRate;
  let start = -1;
  for (let f = 0; f <= frames; f++) {
    const silent = f < frames && db[f] < threshold;
    if (silent && start < 0) start = f;
    if (!silent && start >= 0) {
      const a = (start * hop) / sampleRate, b = Math.min(total, (f * hop) / sampleRate);
      if (b - a >= minSeconds) spans.push([a, b]);
      start = -1;
    }
  }
  return spans;
}

/** Read any stem as mono samples. A non-WAV stem (FLAC) is decoded by `clickbait-audio wav` first. */
export function readMonoAudio(path: string): { samples: Float32Array; sampleRate: number } {
  if (path.toLowerCase().endsWith(".wav")) return readMonoWav(path);
  const dir = mkdtempSync(join(tmpdir(), "clickbait-wav-"));
  try {
    const wav = join(dir, "decoded.wav");
    execFileSync(BIN, ["wav", path, wav]);
    return readMonoWav(wav);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Read a PCM (16-bit) or float (32-bit) WAV as mono samples. */
export function readMonoWav(path: string): { samples: Float32Array; sampleRate: number } {
  const b = readFileSync(path);
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") throw new Error(`not a WAV file: ${path}`);
  let off = 12, format = 1, channels = 1, sampleRate = 44100, bits = 16, dataOff = -1, dataLen = 0;
  while (off + 8 <= b.length) {
    const id = b.toString("ascii", off, off + 4), size = b.readUInt32LE(off + 4);
    if (id === "fmt ") {
      format = b.readUInt16LE(off + 8);
      // WAVE_FORMAT_EXTENSIBLE keeps the real format code at the start of its sub-format GUID.
      if (format === 0xfffe && size >= 40) format = b.readUInt16LE(off + 8 + 24);
      channels = b.readUInt16LE(off + 10);
      sampleRate = b.readUInt32LE(off + 12);
      bits = b.readUInt16LE(off + 22);
    } else if (id === "data") {
      dataOff = off + 8;
      dataLen = Math.min(size, b.length - dataOff);
      break;
    }
    off += 8 + size + (size & 1);
  }
  const float = format === 3 && bits === 32;
  if (dataOff < 0 || !(float || bits === 16)) throw new Error(`unsupported WAV (format ${format}, ${bits}-bit): ${path}`);
  const bytes = bits / 8, n = Math.floor(dataLen / (bytes * channels));
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < channels; c++) {
      const p = dataOff + (i * channels + c) * bytes;
      s += float ? b.readFloatLE(p) : b.readInt16LE(p) / 32768;
    }
    samples[i] = s / channels;
  }
  return { samples, sampleRate };
}
