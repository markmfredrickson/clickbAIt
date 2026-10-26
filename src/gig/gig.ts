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
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, normalize, resolve } from "node:path";
import { z } from "zod";

const DEFAULT_MIX = 0.6;
const Mix = z.number().min(0).max(1);

const GigSchema = z
  .object({
    board: z.string().optional(),
    mix: Mix.optional(),
    songs: z.array(
      z
        .object({
          song: z.string(),
          phone: z.string(),
          audio: z.enum(["board", "phone"]).default("board"),
          mix: Mix.optional(),
        })
        .strict(),
    ),
  })
  .strict();

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
  const { board, songs, mix } = parsed.data;
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
      return {
        n: String(i + 1).padStart(2, "0"),
        slug: basename(songDir),
        dir: songDir,
        manifest: join(songDir, manifests[0]),
        phone: normalize(s.phone),
        audio: s.audio,
        mix: s.audio === "phone" ? 0 : (s.mix ?? mix ?? DEFAULT_MIX),
      };
    }),
  };
}
