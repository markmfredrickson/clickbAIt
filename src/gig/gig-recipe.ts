/**
 * The gig's wireit unit (its package.json), written from gig.json: one task per
 * song for each step, so a changed video re-runs only its own song.
 *
 *   sync      where each phone video starts in the board recording
 *             (`sync/<nn>-<slug>.sync.json`). Songs that take their audio from
 *             the phone have nothing to sync.
 *   vocals    the singer, split out of the board recording over the span of the
 *             video, or out of the phone's own sound (`work/<nn>-<slug>.vocals.flac`).
 *   lyrics    the manifest's lyric lines, in order, as text for the aligner.
 *   align     desilence-align of those lines against the vocal.
 *   captions  the aligned words on the video's timeline (`captions/<nn>-<slug>.words.json`)
 *             and an SRT to upload beside the video (`captions/<nn>-<slug>.srt`).
 */

import { relative } from "node:path";
import type { Gig } from "./gig.js";

type Task = { command: string; files?: string[]; output?: string[]; dependencies?: string[] };

/** `rel` is the path from the gig folder to the repo root. */
export function gigRecipe(gig: Gig, rel: string): Record<string, unknown> {
  const tsx = (file: string) => `npx tsx ${rel}/src/${file}`;
  const scripts: Record<string, string> = { sync: "wireit", captions: "wireit" };
  const wireit: Record<string, Task> = {};
  const add = (name: string, task: Task) => {
    scripts[name] = "wireit";
    wireit[name] = task;
  };
  const syncs: string[] = [];
  const captions: string[] = [];

  for (const s of gig.songs) {
    const key = `${s.n}-${s.slug}`;
    const sync = `sync/${key}.sync.json`;
    const vocals = `work/${key}.vocals.flac`;
    const lyrics = `work/${key}.lyrics.txt`;
    const align = `work/${key}.align.json`;
    const manifest = relative(gig.dir, s.manifest);
    const fromBoard = s.audio === "board";

    if (fromBoard) {
      add(`sync:${key}`, {
        command: `${tsx("gig/sync-cli.ts")} "${gig.board}" "${s.phone}" ${sync}`,
        files: [gig.board!, s.phone],
        output: [sync],
      });
      syncs.push(`sync:${key}`);
    }
    add(`vocals:${key}`, {
      command: `${tsx("gig/vocals-cli.ts")} "${s.phone}" ${vocals}` + (fromBoard ? ` --board "${gig.board}" --sync ${sync}` : ""),
      files: fromBoard ? [gig.board!, s.phone] : [s.phone],
      output: [vocals],
      ...(fromBoard ? { dependencies: [`sync:${key}`] } : {}),
    });
    add(`lyrics:${key}`, {
      command: `${tsx("authoring/lyrics-text-cli.ts")} --manifest "${manifest}" ${lyrics}`,
      files: [manifest],
      output: [lyrics],
    });
    add(`align:${key}`, {
      command: `${tsx("authoring/desilence-align-cli.ts")} ${vocals} --text ${lyrics} -o ${align}`,
      files: [vocals, lyrics],
      output: [align],
      dependencies: [`vocals:${key}`, `lyrics:${key}`],
    });
    add(`captions:${key}`, {
      command: `${tsx("gig/captions-cli.ts")} ${align} captions/${key}` + (fromBoard ? ` --sync ${sync}` : ""),
      files: fromBoard ? [align, sync] : [align],
      output: [`captions/${key}.srt`, `captions/${key}.words.json`],
      dependencies: [`align:${key}`],
    });
    captions.push(`captions:${key}`);
  }
  wireit.sync = { command: `node -e ""`, dependencies: syncs };
  wireit.captions = { command: `node -e ""`, dependencies: captions };

  return { name: "clickbait-gig", private: true, scripts, wireit };
}
