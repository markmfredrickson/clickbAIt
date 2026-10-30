/**
 * A gig's recordings (`gig.json` in `songs/gigs/<date>/`), authored after the
 * show: the board recording and, for each song played, the phone video and
 * where its sound comes from.
 *
 *   {
 *     "board": "media/board.m4a",
 *     "songs": [
 *       { "song": "songs/deermouse/the-white-stripes/seven-nation-army",
 *         "phone": "media/01-seven-nation-army.mov", "audio": "phone" },
 *       { "song": "songs/deermouse/supremes/you-cant-hurry-love",
 *         "phone": "media/02-you-cant-hurry-love.mov" }
 *     ]
 *   }
 *
 * Song folders are written as in a set list, from the repo root. Media paths
 * are relative to the gig folder. `audio` is "board" unless the board missed
 * the song, which the file says outright rather than leaving the sync to fail.
 *
 * `mix` is the board's share of a video's sound, the rest being the phone's
 * room sound: 0.6 unless the gig or the song sets it. A song the board missed
 * has no board to mix in, so it is 0 there and setting it is an error.
 *
 * `in` and `out` cut a song's video to the part worth keeping, in the
 * video's seconds; without them the whole video is used.
 *
 * `crop` keeps part of a song's picture in its final video: a 16:9 box given
 * as fractions of the frame, `{ x, y, size, angle? }`, or a list of boxes keyed
 * by time that glide from one to the next (see crop.ts), or curves pinned by
 * knots that can follow the camera, `{ follow, smooth?, knots }` (see
 * follow.ts). It is per song because the phone moves between songs.
 *
 * `grade`, for the gig or a song, asks for the final videos to be graded:
 * each song's levels matched to a target as the light changes, then a warmer,
 * more colourful look (see grade.ts). `{}` takes the defaults; a song's grade
 * changes the gig's, and `"match": false` leaves its levels alone.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, normalize, resolve } from "node:path";
import { z } from "zod";
import { type CropKey, DEFAULT_GLIDE } from "./crop.js";
import { type CurveCrop, DEFAULT_SMOOTH } from "./follow.js";
import { DEFAULT_GRADE, type Grade } from "./grade.js";

const DEFAULT_MIX = 0.6;
const Mix = z.number().min(0).max(1);
const Seconds = z.number().min(0);
const boxFields = { x: z.number().min(0), y: z.number().min(0), size: z.number().gt(0).max(1), angle: z.number().min(-45).max(45).optional() };
const inFrame = (c: { x: number; y: number; size: number }) => c.x + c.size <= 1 && c.y + c.size <= 1;
const Box = z.object(boxFields).strict().refine(inFrame, { message: "the box runs off the frame" });
const Key = z
  .object({ at: Seconds, ...boxFields, glide: z.number().gt(0).optional() })
  .strict()
  .refine(inFrame, { message: "the box runs off the frame" });
const Curve = z
  .object({
    follow: z.boolean(),
    smooth: z.number().gt(0).default(DEFAULT_SMOOTH),
    knots: z.array(
      z
        .object({ at: Seconds, ...boxFields, angle: z.number().min(-45).max(45).default(0), width: Seconds.optional(), strength: z.number().min(0).max(1).optional() })
        .strict()
        .refine(inFrame, { message: "the box runs off the frame" }),
    ),
  })
  .strict()
  .refine((c) => c.follow || c.knots.length > 0, { message: "a curve that doesn't follow the band needs a knot" });
// The ranges ffmpeg's eq and colortemperature filters accept.
const gradeFields = {
  low: z.number().min(0).max(1),
  mid: z.number().min(0).max(1),
  high: z.number().min(0).max(1),
  saturation: z.number().min(0).max(3),
  temperature: z.number().min(1000).max(40000),
  smooth: z.number().gt(0),
};
const GigGrade = z.object(gradeFields).partial().strict();
const SongGrade = z.object({ ...gradeFields, match: z.boolean() }).partial().strict();
const Keys = z
  .array(Key)
  .min(1)
  .refine((keys) => keys.every((k, i) => i === 0 || k.at - (k.glide ?? DEFAULT_GLIDE) >= keys[i - 1].at), {
    message: "each box must come after the one before it, with its glide starting once that box is in place",
  });

const GigSchema = z
  .object({
    board: z.string().optional(),
    mix: Mix.optional(),
    grade: GigGrade.optional(),
    songs: z.array(
      z
        .object({
          song: z.string(),
          phone: z.string(),
          audio: z.enum(["board", "phone"]).default("board"),
          mix: Mix.optional(),
          in: Seconds.optional(),
          out: Seconds.optional(),
          crop: z.union([Box, Keys, Curve]).optional(),
          grade: SongGrade.optional(),
        })
        .strict()
        .refine((s) => s.in === undefined || s.out === undefined || s.in < s.out, { message: "out must come after in", path: ["out"] }),
    ),
  })
  .strict();

export interface Cut {
  in?: number;
  out?: number;
}

export interface GigSong {
  /** Position in gig.json, two digits from 01: names every file made for the song. */
  n: string;
  /** The song folder's name. */
  slug: string;
  /** The song folder, absolute. */
  dir: string;
  /** The song's manifest, absolute. */
  manifest: string;
  /** The phone video, relative to the gig folder. */
  phone: string;
  audio: "board" | "phone";
  /** The board's share of the video's sound, 0 to 1. */
  mix: number;
  /** Where the video is cut, in its own seconds; either end may be left open. */
  cut: Cut;
  /** The part of the picture to keep in the final video: keyed boxes (see crop.ts) or curves (see follow.ts). */
  crop?: CropKey[] | CurveCrop;
  /** How the final video is graded (see grade.ts); `match` is whether its levels are matched. Absent when gig.json doesn't ask for a grade. */
  grade?: Grade & { smooth: number; match: boolean };
}

export interface Gig {
  /** The gig folder, absolute. */
  dir: string;
  /** The board recording, relative to the gig folder. */
  board?: string;
  songs: GigSong[];
}

export function readGig(dir: string, root: string): Gig {
  const file = join(dir, "gig.json");
  const parsed = GigSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`${file}: ${issue.path.join(".")}: ${issue.message}`);
  }
  const { board, songs, mix, grade } = parsed.data;
  return {
    dir,
    ...(board !== undefined ? { board: normalize(board) } : {}),
    songs: songs.map((s, i) => {
      const songDir = resolve(root, s.song);
      if (!existsSync(songDir) || !statSync(songDir).isDirectory()) {
        throw new Error(`${file}: songs.${i}.song: ${s.song} is not a song folder`);
      }
      const manifests = readdirSync(songDir).filter((f) => f.endsWith(".song.json"));
      if (manifests.length !== 1) {
        throw new Error(`${file}: songs.${i}.song: ${s.song} has ${manifests.length || "no"} manifests; it needs one`);
      }
      if (s.audio === "board" && board === undefined) {
        throw new Error(`${file}: songs.${i}: ${s.song} takes its audio from the board, but there is no "board" recording`);
      }
      if (s.audio === "phone" && s.mix !== undefined && s.mix !== 0) {
        throw new Error(`${file}: songs.${i}.mix: ${s.song} takes its audio from the phone, so there is no board to mix in`);
      }
      let songGrade: GigSong["grade"];
      if (grade || s.grade) {
        const { match = true, ...own } = s.grade ?? {};
        songGrade = { ...DEFAULT_GRADE, ...grade, ...own, match };
        if (!(songGrade.low < songGrade.mid && songGrade.mid < songGrade.high)) {
          throw new Error(`${file}: songs.${i}.grade: low, mid and high must each be brighter than the last`);
        }
      }
      return {
        n: String(i + 1).padStart(2, "0"),
        slug: basename(songDir),
        dir: songDir,
        manifest: join(songDir, manifests[0]),
        phone: normalize(s.phone),
        audio: s.audio,
        mix: s.audio === "phone" ? 0 : (s.mix ?? mix ?? DEFAULT_MIX),
        cut: { ...(s.in !== undefined ? { in: s.in } : {}), ...(s.out !== undefined ? { out: s.out } : {}) },
        ...(s.crop ? { crop: Array.isArray(s.crop) || "knots" in s.crop ? s.crop : [{ at: s.in ?? 0, ...s.crop }] } : {}),
        ...(songGrade ? { grade: songGrade } : {}),
      };
    }),
  };
}
