/**
 * A song's 16:9 review render: the phone's picture with the board and the
 * phone's own sound mixed under it, and the captions as a subtitle track.
 *
 * It takes two ffmpeg passes. The first mixes the sound (`mixArgs`) after each
 * source is brought to the target loudness, so a 60/40 share means 60/40 of
 * equally loud sources. The second measures nothing; it takes the picture,
 * moves the mix's measured loudness to the target, limits its peaks and
 * attaches the SRT (`reviewArgs`).
 *
 * ffmpeg trims each file's encoder delay as it decodes, and a sync offset is
 * already in those trimmed times (see `correctOffset`), so seeking the board to
 * the span start lands on the video's first frame.
 */

import { boardSpan, type Sync } from "./timeline.js";

/** YouTube's loudness. */
export const TARGET_LUFS = -14;
const RATE = 48000;
/** The board is resampled this high before its rate is relabelled, so the rounding leaves at most 1.3 ppm of drift. */
const UPSAMPLE = 384000;

const fromDb = (db: number) => 10 ** (db / 20);

/**
 * Linear gains that bring each source to the target loudness and then weight
 * it by its share: the board by `mix`, the phone by the rest. With no board
 * (`boardLufs` null) the phone takes it all.
 */
export function mixGains(m: { boardLufs: number | null; phoneLufs: number; mix: number }): { board: number; phone: number } {
  if (m.boardLufs === null) return { board: 0, phone: fromDb(TARGET_LUFS - m.phoneLufs) };
  return {
    board: fromDb(TARGET_LUFS - m.boardLufs) * m.mix,
    phone: fromDb(TARGET_LUFS - m.phoneLufs) * (1 - m.mix),
  };
}

/** The gain, in dB, that moves the mixed sound to the target. */
export function finalGainDb(mixLufs: number): number {
  return TARGET_LUFS - mixLufs;
}

export interface MixInput {
  phone: string;
  /** The board recording and the video's sync with it; both absent for a phone-audio song. */
  board?: string;
  sync?: Sync;
  videoSeconds: number;
  gains: { board: number; phone: number };
  /** An audio file, e.g. FLAC. */
  out: string;
}

/** ffmpeg arguments for the first pass: the sound, on the video's timeline. */
export function mixArgs(m: MixInput): string[] {
  const phone = `[0:a]aresample=${RATE},aformat=channel_layouts=stereo,volume=${m.gains.phone}`;
  if (!m.board || !m.sync) {
    return ["-y", "-v", "error", "-i", m.phone, "-filter_complex", `${phone}[out]`, "-map", "[out]", m.out];
  }
  const span = boardSpan(m.sync, m.videoSeconds);
  // The board's clock runs (1 + drift) against the phone's; relabelling its
  // rate by that much plays it on the phone's clock.
  const stretched = Math.round(UPSAMPLE * (1 + (m.sync.drift_ppm ?? 0) * 1e-6));
  // When the video started first, the board's first sample lands this far into it.
  const lead = m.sync.offset < 0 ? Math.round((-m.sync.offset / (1 + (m.sync.drift_ppm ?? 0) * 1e-6)) * RATE) : 0;
  const board =
    `[1:a]aresample=${UPSAMPLE},asetrate=${stretched},aresample=${RATE},aformat=channel_layouts=stereo,` +
    (lead > 0 ? `adelay=${lead}S:all=1,` : "") +
    `volume=${m.gains.board}`;
  return [
    "-y", "-v", "error",
    "-i", m.phone,
    "-ss", String(span.start), "-t", String(span.seconds), "-i", m.board,
    "-filter_complex", `${phone}[p];${board}[b];[p][b]amix=inputs=2:duration=first:normalize=0[out]`,
    "-map", "[out]", m.out,
  ];
}

export interface ReviewInput {
  phone: string;
  mix: string;
  srt: string;
  gainDb: number;
  out: string;
}

/** ffmpeg arguments for the second pass: picture, finished sound and subtitles in one file. */
export function reviewArgs(r: ReviewInput): string[] {
  return [
    "-y", "-v", "error",
    "-i", r.phone, "-i", r.mix, "-i", r.srt,
    "-map", "0:v:0", "-map", "1:a:0", "-map", "2:s:0",
    "-vf", "scale=-2:720",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
    // A sample-peak limit half a dB under -1 dBTP leaves room for intersample peaks.
    "-af", `volume=${r.gainDb}dB,alimiter=limit=-1.5dB:level=disabled`,
    "-c:a", "aac", "-b:a", "192k",
    "-c:s", "mov_text", "-metadata:s:s:0", "language=eng", "-disposition:s:0", "0",
    "-movflags", "+faststart",
    r.out,
  ];
}
