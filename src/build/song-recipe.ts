/**
 * The per-song build recipe — a wireit `package.json` that runs the WHOLE
 * pipeline as content-hashed tasks, from raw `source.m4a` to the RPP + bundle.
 *
 * There are two halves with a human seam between them:
 *
 *   Analysis (input: source.m4a) — split, lookup, lyrics-txt, beats, align.
 *     `npm run analyze` fans these out. Each caches on its inputs.
 *   ── you author the manifest here (`npm run init-manifest` writes the first cut) ──
 *   Build (input: the manifest) — smooth, timing, render, build, bundle.
 *     `npm run build` writes the timing files, renders the visuals when the song
 *     has a scene, then assembles the RPP with the video on it; `-- bundle`
 *     renders audio.
 *
 * `init-manifest` and `beats` are STANDALONE one-shots, never build dependencies:
 *   - `beats` so a hand-tuned detection (narrowed --min/--max-bpm, --start/--until)
 *     is never silently re-run by a `build`.
 *   - `init-manifest` so a rebuild never clobbers your hand-authored sections. It
 *     is also guarded to refuse an existing manifest (see init-manifest-cli).
 *
 * Both `init-song` (writes it up front, before any analysis) and `generate` (the
 * legacy path, writes it only if still missing) build the recipe from here, so
 * there is one definition of the tasks.
 */

export interface SongRecipeOpts {
  slug: string;
  title: string;
  artist?: string;
  key?: string;
  /** Relative path from the song folder to the repo root, e.g. "../../..". */
  rel: string;
  /** Stem model passed to `split` (default "4stem"). */
  model?: string;
  /** Beat-detection tempo window. Narrow these after `lookup` reports the BPM. */
  minBpm: number;
  maxBpm: number;
  /** The recording file the manifest references — always "source.m4a". */
  recFile?: string;
  /**
   * Whether to wire an `align` TASK into this recipe. True for the normal
   * ground-up flow (a demucs `stems/source_vocals.wav` + a lyrics text).
   *
   * False for KV/multitrack songs. Those still HAVE vocals — a `lead vocal`
   * track in `sources.stems.files` — they just have no demucs split for the
   * task to point at. Their alignment is produced out-of-band by
   * `npm run realign-all`, which locates the vocal audio beside the manifest's
   * `lyrics.alignment.file` and runs desilence-align on it. So the align.json
   * is generated either way; only the producing task differs.
   */
  canAlign?: boolean;
  /** Vocal stem to align (default the 4-stem convention). */
  alignStem?: string;
  /** Alignment sidecar to write (default the 4-stem convention). */
  alignFile?: string;
}

/** Shell-quote a value that goes inside a double-quoted command argument. */
function q(s: string): string {
  return s.replace(/"/g, '\\"');
}

/** Score files a chart can come from: Guitar Pro, MusicXML, alphaTex. */
/** A song's notes for the card before it (manifest `notes`). */
export const NOTES_FILE_GLOB = "*.notes.txt";

export const SCORE_GLOBS = ["*.gp", "*.gp3", "*.gp4", "*.gp5", "*.gpx", "*.musicxml", "*.mxl", "*.atex"];

/** Chord files (manifest `chords`), named `<slug>.chords.lab` so the build sees edits. */
export const CHORD_FILE_GLOB = "*.chords.lab";

/** What every visuals render reads: the scene, the timing, the stems' features, the footage. */
export const RENDER_FILES = ["*.scene.js", "*.lyrics-display.json", "*.rows.json", "*.beat-features.json", "footage/footage.json", "footage/*.mp4"];
/** What the timing half of generate writes. */
export const TIMING_OUTPUT = ["*.lyrics-display.json", "*.charts.json", "*.rows.json", "cues/**"];

/**
 * Build the per-song wireit unit (the parsed package.json object). Callers
 * JSON.stringify it. Task commands are CWD-relative to the song folder; paths
 * into the repo go through `rel`.
 */
export function songRecipe(opts: SongRecipeOpts): Record<string, unknown> {
  const { slug, title, artist, key, rel, minBpm, maxBpm } = opts;
  const model = opts.model ?? "4stem";
  const recFile = opts.recFile ?? "source.m4a";
  const canAlign = opts.canAlign ?? true;
  const bin = `${rel}/.claude/skills/clickbait/bin/clickbait-audio`;

  const lyricsTxt = `${slug}.lyrics.txt`;
  const lookupJson = `${slug}.lookup.json`;
  const manifest = `${slug}.song.json`;
  const beatsJson = `${recFile}.beats.json`;
  const beatmapJson = `${recFile}.beatmap.json`;
  const alignStem = opts.alignStem ?? "stems/source_vocals.wav";
  const alignFile = opts.alignFile ?? "stems/source_vocals.align.json";

  const scripts: Record<string, string> = {
    split: "wireit",
    lookup: "wireit",
    "lyrics-txt": "wireit",
    beats: "wireit",
    "init-manifest": "wireit",
    analyze: "wireit",
    smooth: "wireit",
    timing: "wireit",
    render: "wireit",
    build: "wireit",
    features: "wireit",
    bundle: "wireit",
  };
  if (canAlign) scripts.align = "wireit";

  // ── Analysis half ────────────────────────────────────────────────────────
  // split: source.m4a → the 4 (or 6) role stems. The declared outputs are the
  // ones the downstream tasks consume; a 6stem model also writes guitar/piano,
  // but those aren't wired here.
  const split = {
    command: `${bin} split source.m4a --output-dir stems --model ${model}`,
    files: ["source.m4a"],
    output: [
      "stems/source_drums.wav",
      "stems/source_bass.wav",
      "stems/source_other.wav",
      "stems/source_vocals.wav",
    ],
  };

  // lookup: Deezer BPM + Genius lyrics + MusicBrainz. No file inputs (it hits
  // the network); wireit re-runs it when the command string — i.e. the
  // title/artist — changes, and otherwise treats the sidecar as fresh.
  const lookup = {
    command: `npx tsx ${rel}/src/authoring/lookup/cli.ts "${q(title)}"${artist ? ` -a "${q(artist)}"` : ""} > ${lookupJson}`,
    output: [lookupJson],
  };

  // lyrics-txt: flat lyric text for the aligner, extracted file-to-file so the
  // lyrics never pass through the model.
  const lyricsTxtTask = {
    command: `npx tsx ${rel}/src/authoring/lyrics-text-cli.ts ${lookupJson} ${lyricsTxt}`,
    files: [lookupJson],
    output: [lyricsTxt],
    dependencies: ["lookup"],
  };

  // beats: single drum-stem detection (energy activation). STANDALONE — nothing
  // depends on it, so `build` never re-runs it. Hand-tune the tempo window (and
  // add --start/--until to crop a loose intro/outro) after lookup. For songs
  // with drum-SILENT passages, detect two-pass + `beats:unify` by hand instead.
  const beats = {
    command: `${bin} beats stems/source_drums.wav --min-bpm ${minBpm} --max-bpm ${maxBpm} > ${beatsJson}`,
    files: ["stems/source_drums.wav"],
    output: [beatsJson],
    dependencies: ["split"],
  };

  // align: single-shot wav2vec2 CTC forced alignment of the authored lyrics
  // against the vocal stem. (A chunked aligner is being explored on a feature
  // branch; when it lands, swap this one command.)
  const align = canAlign
    ? {
        command: `${bin} align "${alignStem}" --text "${lyricsTxt}" -o "${alignFile}"`,
        files: [alignStem, lyricsTxt],
        output: [alignFile],
        dependencies: ["split", "lyrics-txt"],
      }
    : undefined;

  // init-manifest: the mechanical first-cut manifest from beats + lookup + align.
  // STANDALONE one-shot — never a dependency (so a rebuild can't clobber the
  // authored sections). init-manifest-cli refuses an existing manifest unless forced.
  const initManifest = {
    command:
      `npx tsx ${rel}/src/authoring/init-manifest-cli.ts` +
      ` --title "${q(title)}"` +
      (artist ? ` --artist "${q(artist)}"` : "") +
      (key ? ` --key ${key}` : "") +
      ` --source source.m4a --beats ${beatsJson} --lookup ${lookupJson}` +
      (canAlign ? ` --align ${alignFile}` : "") +
      ` --stems-dir stems --out ${manifest}`,
  };

  // analyze: aggregate — run every analysis task, then init-manifest + author.
  const analyze = {
    command: `node -e "process.stdout.write('analysis complete: npm run init-manifest, author the manifest, then npm run build\\n')"`,
    dependencies: canAlign ? ["beats", "align"] : ["beats"],
  };

  // ── Build half ───────────────────────────────────────────────────────────
  // smooth: de-warble the raw beats against the manifest anchor → beatmap.
  const smooth = {
    command: `npx tsx ${rel}/src/authoring/smooth-beats-cli.ts ${manifest} --max-warble 0.04`,
    files: [beatsJson, manifest],
    output: [beatmapJson],
  };

  // generate's inputs. The analysis tasks (split/lookup/lyrics-txt/align) are
  // prep run by `analyze`, NOT build deps — the build consumes their output as
  // file inputs (the align.json glob, the beatmap), so it re-runs when they
  // change but never drags the network `lookup` (which is uncacheable) or the
  // slow `align` into every build. Same standalone philosophy as `beats`.
  // Score files and chord files are chart sources (manifest `charts`, `chords`);
  // the build maps them into <slug>.charts.json.
  const generateFiles = [manifest, beatmapJson, "stems/*.align.json", `${rel}/default.json`, ...SCORE_GLOBS, CHORD_FILE_GLOB, NOTES_FILE_GLOB];

  // timing: the project-time files (lyrics-display, rows, charts) and the spoken
  // cues — everything the visuals render reads.
  const timing = {
    command: `npx tsx ${rel}/src/build/generate.ts ${manifest} --part timing`,
    files: generateFiles,
    output: TIMING_OUTPUT,
    dependencies: ["smooth"],
  };

  // render: the scene's gig master, <slug>.visuals.mp4, in project time. A song
  // without a <slug>.scene.js renders nothing. A scene that loads files beside
  // it (images, outlines) needs those added to `files` here, by hand.
  const render = {
    command: `npx tsx ${rel}/src/visuals/render-cli.ts ${manifest} --skip-without-scene`,
    files: RENDER_FILES,
    output: ["*.visuals.mp4"],
    dependencies: ["timing", "features"],
  };

  // build: the RPP, after the render, so its Visuals track always plays a render
  // of the current timing.
  const build = {
    command: `npx tsx ${rel}/src/build/generate.ts ${manifest} --part project`,
    files: generateFiles,
    output: ["*.RPP"],
    dependencies: ["timing", "render"],
  };

  // features: per-stem loudness, onsets, brightness and bands on the beat grid,
  // for visuals. Deterministic and cheap (about a second a stem), so it follows
  // the beatmap like build does rather than standing alone like beats.
  const features = {
    command: `npx tsx ${rel}/src/visuals/features-cli.ts ${manifest}`,
    files: [manifest, beatmapJson, "stems/*.wav"],
    output: ["*.beat-features.json", "stems/*.features.json"],
    dependencies: ["smooth"],
  };

  // bundle: render the mix + take-home bundle (REAPER; opt-in). render-bundle
  // also writes bundles/<slug>/ + .zip at the repo root, which wireit can't
  // declare as outputs (outside the package), so those stay side effects.
  const bundle = {
    command: `npx tsx ${rel}/scripts/render-bundle.ts .`,
    files: [manifest, beatmapJson, "stems/**", "source.*", `${rel}/default.json`],
    output: ["*.opus"],
    dependencies: ["smooth"],
  };

  const wireit: Record<string, unknown> = {
    split,
    lookup,
    "lyrics-txt": lyricsTxtTask,
    beats,
    ...(align ? { align } : {}),
    "init-manifest": initManifest,
    analyze,
    smooth,
    timing,
    render,
    build,
    features,
    bundle,
  };

  return { name: `clickbait-song-${slug}`, private: true, scripts, wireit };
}

type Task = { command: string; files?: string[]; output?: string[]; dependencies?: string[] };

/**
 * Upgrade a recipe written before the render task (one `build` running all of
 * generate) to timing → render → build, as `songRecipe` writes it now. The
 * song's own tasks and build inputs are kept. `extra` adds what the scene loads
 * beside it (`files`) and tasks that make those files (`dependencies`).
 */
export function addVisualsTasks(
  recipe: Record<string, unknown>,
  extra: { files?: string[]; dependencies?: string[] },
): Record<string, unknown> {
  const scripts = { ...(recipe.scripts as Record<string, string>) };
  const wireit = { ...(recipe.wireit as Record<string, Task>) };
  if (wireit.render || wireit.timing) throw new Error("this recipe already has the timing and render tasks");
  if (!wireit.features) throw new Error("the render reads the stems' features; add a features task first");
  const build = wireit.build;
  const m = build?.command.match(/^npx tsx (\S+)\/src\/build\/generate\.ts (\S+\.song\.json)$/);
  if (!m) throw new Error(`can't read the build command: ${build?.command}`);
  const [, rel, manifest] = m;

  wireit.timing = { command: `${build.command} --part timing`, files: build.files, output: TIMING_OUTPUT, dependencies: build.dependencies };
  wireit.render = {
    command: `npx tsx ${rel}/src/visuals/render-cli.ts ${manifest} --skip-without-scene`,
    files: [...RENDER_FILES, ...(extra.files ?? [])],
    output: ["*.visuals.mp4"],
    dependencies: ["timing", "features", ...(extra.dependencies ?? [])],
  };
  wireit.build = { command: `${build.command} --part project`, files: build.files, output: ["*.RPP"], dependencies: ["timing", "render"] };
  scripts.timing = "wireit";
  scripts.render = "wireit";
  return { ...recipe, scripts, wireit };
}
