/**
 * init-song — scaffold a new song folder and its wireit build recipe UP FRONT,
 * before any analysis has run. This is the first step for a new song: it writes
 * `<dir>/package.json` with the whole pipeline (split, lookup,
 * beats, align, scaffold, smooth, build, bundle) as tasks, so every step from
 * raw audio to finished RPP is a content-hashed, re-runnable wireit task.
 *
 * Usage:
 *   npm run song:init -- --dir songs/my-band/michael-jackson/billie-jean \
 *     --title "Billie Jean" --artist "Michael Jackson" \
 *     [--key F#m] [--bpm 117] [--model 4stem] [--source songs/dls/whatever.m4a]
 *
 * --dir is the song's folder, anywhere and at any depth: every band lays its
 * songs out differently, so the tool is told where rather than guessing.
 *
 * --source, if given, is MOVED and renamed to <songdir>/source.m4a. Otherwise
 * you place source.m4a in the folder yourself. --bpm is an optional hint that
 * sets the beats task's tempo window (±10%); without it the window is wide and
 * you narrow it after `npm run lookup` reports the BPM.
 *
 * After init:
 *   cd <dir>
 *   npm run analyze          # split + lookup + lyrics-txt + beats + align
 *   npm run init-manifest    # first-cut manifest (author it after)
 *   npm run build            # smooth + align + generate → RPP
 */

import { existsSync, renameSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { toSlug } from "../core/dsongl/slug.js";
import { initSongDir } from "./init-song-dir.js";
import { songRecipe } from "./song-recipe.js";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const title = flag("title");
const artist = flag("artist");
if (!title) {
  console.error(
    'usage: npm run song:init -- --dir <song folder> --title "<t>" [--artist "<a>"] [--key <k>] [--bpm <n>] [--model 4stem|6stem] [--source <file>]',
  );
  process.exit(1);
}

const key = flag("key");
const model = flag("model") ?? "4stem";
const bpmHint = flag("bpm") ? Number(flag("bpm")) : undefined;
const sourceArg = flag("source");

const root = process.cwd();
const slug = toSlug(title);
let songDir: string;
let rel: string;
try {
  ({ songDir, rel } = initSongDir(flag("dir"), root));
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

// Move the source into place as source.m4a, if given.
const dest = join(songDir, "source.m4a");
if (sourceArg) {
  const src = resolve(sourceArg);
  if (!existsSync(src)) {
    console.error(`--source not found: ${sourceArg}`);
    process.exit(1);
  }
  renameSync(src, dest);
  console.error(`moved ${relative(root, src)} → ${relative(root, dest)}`);
}

// Beats tempo window: tight around a --bpm hint, else a wide pop/rock default
// the author narrows after lookup (a wide window lets the tracker wander).
const minBpm = bpmHint ? Math.round(bpmHint * 0.9) : 80;
const maxBpm = bpmHint ? Math.round(bpmHint * 1.1) : 160;

const unit = songRecipe({ slug, title, artist, key, rel, model, minBpm, maxBpm });
const pkgPath = join(songDir, "package.json");
writeFileSync(pkgPath, JSON.stringify(unit, null, 2) + "\n");

const dir = relative(root, songDir);
console.error(`wrote ${relative(root, pkgPath)}`);
if (!existsSync(dest)) {
  console.error(`\n⚠ no source audio yet — put the mix at ${relative(root, dest)} (or re-run with --source <file>)`);
}
if (!bpmHint) {
  console.error(`\nbeats window is a wide default (${minBpm}–${maxBpm}); narrow it after \`npm run lookup\`.`);
}
console.error(`\nnext:`);
console.error(`  cd ${dir}`);
console.error(`  npm run analyze        # split + lookup + lyrics-txt + beats + align`);
console.error(`  npm run init-manifest  # first-cut manifest — then author its sections`);
console.error(`  npm run build          # smooth + align + generate → RPP + lyrics`);
