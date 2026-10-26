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
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, normalize, resolve } from "node:path";
import { z } from "zod";

const GigSchema = z
  .object({
    board: z.string().optional(),
    songs: z.array(
      z
        .object({
          song: z.string(),
          phone: z.string(),
          audio: z.enum(["board", "phone"]).default("board"),
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
  /** The phone video, relative to the gig folder. */
  phone: string;
  audio: "board" | "phone";
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
  const { board, songs } = parsed.data;
  return {
    dir,
    ...(board !== undefined ? { board: normalize(board) } : {}),
    songs: songs.map((s, i) => {
      const songDir = resolve(root, s.song);
      if (!existsSync(songDir) || !statSync(songDir).isDirectory()) {
        throw new Error(`${file}: songs.${i}.song: ${s.song} is not a song folder`);
      }
      if (s.audio === "board" && board === undefined) {
        throw new Error(`${file}: songs.${i}: ${s.song} takes its audio from the board, but there is no "board" recording`);
      }
      return { n: String(i + 1).padStart(2, "0"), slug: basename(songDir), dir: songDir, phone: normalize(s.phone), audio: s.audio };
    }),
  };
}
