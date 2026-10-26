/**
 * The gig's wireit unit (its package.json), written from gig.json: one task per
 * song for each step, so a changed video re-runs only its own song.
 *
 *   sync — where each phone video starts in the board recording
 *          (`sync/<nn>-<slug>.sync.json`). Songs that take their audio from
 *          the phone have nothing to sync.
 */

import type { Gig } from "./gig.js";

type Task = { command: string; files?: string[]; output?: string[]; dependencies?: string[] };

/** `rel` is the path from the gig folder to the repo root. */
export function gigRecipe(gig: Gig, rel: string): Record<string, unknown> {
  const bin = `${rel}/.claude/skills/clickbait/bin/clickbait-audio`;
  const scripts: Record<string, string> = { sync: "wireit" };
  const wireit: Record<string, Task> = {};
  const syncs: string[] = [];

  for (const s of gig.songs) {
    if (s.audio !== "board") continue;
    const name = `sync:${s.n}-${s.slug}`;
    const out = `sync/${s.n}-${s.slug}.sync.json`;
    scripts[name] = "wireit";
    wireit[name] = {
      command: `mkdir -p sync && ${bin} offset "${gig.board}" "${s.phone}" > ${out}`,
      files: [gig.board!, s.phone],
      output: [out],
    };
    syncs.push(name);
  }
  wireit.sync = { command: `node -e ""`, dependencies: syncs };

  return { name: "clickbait-gig", private: true, scripts, wireit };
}
