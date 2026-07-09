/**
 * Perceptual attack detection for short spoken-cue WAVs (count numbers, section
 * names), used to place a cue so its syllable lands ON the beat.
 *
 * We use an ENERGY envelope, not spectral-flux musical-onset detection: the cues
 * are ~0.3–1s of speech, where spectral flux is both unreliable (quiet digits
 * report no onsets) and, in the Rust `analyze`, buggy on very short buffers. RMS
 * segmentation is robust and cheap.
 *
 * A "voiced segment" is a run where RMS rises above a fraction of the file's peak.
 * The segment START is a syllable attack. For a count number we want the FIRST
 * attack (the digit's onset); for a section name used as a pickup we want the
 * LAST attack (the final syllable, which resolves onto the beat).
 */

import { readFileSync } from "node:fs";

/** Parse a 16-bit PCM WAV into mono Float32 samples + sample rate. */
function readWav(path: string): { samples: Float32Array; sampleRate: number } {
  const b = readFileSync(path);
  let off = 12; // past "RIFF"<size>"WAVE"
  let dataOff = -1, dataLen = 0, sampleRate = 44100, channels = 1, bits = 16;
  while (off + 8 <= b.length) {
    const id = b.toString("ascii", off, off + 4);
    const sz = b.readUInt32LE(off + 4);
    if (id === "fmt ") {
      channels = b.readUInt16LE(off + 10);
      sampleRate = b.readUInt32LE(off + 12);
      bits = b.readUInt16LE(off + 22);
    } else if (id === "data") {
      dataOff = off + 8;
      dataLen = sz;
      break;
    }
    off += 8 + sz + (sz & 1);
  }
  if (dataOff < 0 || bits !== 16) throw new Error(`unsupported WAV (bits=${bits}) ${path}`);
  const bytesPerFrame = 2 * channels;
  const n = Math.floor(dataLen / bytesPerFrame);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = b.readInt16LE(dataOff + i * bytesPerFrame) / 32768; // channel 0
  return { samples, sampleRate };
}

/** Syllable-attack times (seconds): the start of each voiced RMS segment. */
export function attacks(
  path: string,
  { hopMs = 5, winMs = 20, floorFrac = 0.18 }: { hopMs?: number; winMs?: number; floorFrac?: number } = {},
): number[] {
  const { samples, sampleRate } = readWav(path);
  const hop = Math.max(1, Math.round((sampleRate * hopMs) / 1000));
  const win = Math.max(hop, Math.round((sampleRate * winMs) / 1000));
  const env: { t: number; v: number }[] = [];
  let peak = 1e-9;
  for (let i = 0; i < samples.length; i += hop) {
    let e = 0, c = 0;
    for (let j = i; j < Math.min(i + win, samples.length); j++) { e += samples[j] * samples[j]; c++; }
    const v = Math.sqrt(e / Math.max(1, c));
    if (v > peak) peak = v;
    env.push({ t: i / sampleRate, v });
  }
  const thr = peak * floorFrac;
  const segs: number[] = [];
  let inSeg = false;
  for (const r of env) {
    if (!inSeg && r.v >= thr) { segs.push(r.t); inSeg = true; }
    else if (inSeg && r.v < thr * 0.7) { inSeg = false; } // hysteresis
  }
  return segs;
}

/**
 * The attack (seconds into the WAV) to align onto the beat: `first` for count
 * numbers (the digit's onset), `last` for section names used as a pickup (the
 * final syllable). Returns 0 if no voiced segment is found (place at the beat).
 */
export function cueOnset(path: string, mode: "first" | "last"): number {
  const a = attacks(path);
  if (a.length === 0) return 0;
  return mode === "first" ? a[0] : a[a.length - 1];
}
