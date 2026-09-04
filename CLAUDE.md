# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working Style

**Don't race ahead.** The user communicates in short messages. Multiple messages may be part of one thought. Do NOT immediately edit files or run commands after each message. Wait until it's clear the user is done and you understand the full picture before acting. When in doubt, ask.

**Editing the clickbait skill.** When the user says "edit the skill" (or anything equivalent), they mean edit the source template under `skill/` (e.g. `skill/SKILL.md.njk`, `skill/stems.md`, `skill/teleprompter.md`) and then rebuild with `npm run build:skill`. Never hand-edit `.claude/skills/clickbait/SKILL.md` directly — it is a generated artifact and will be overwritten.

**Don't guess what's derived — read the recipe.** Before claiming a file is hand-written, open the song's `package.json` wireit block and check whether some task declares it as an `output`. Most files in a song folder are generated. See "Build Model" below.

**No Python for end-user tasks.** End users are not expected to have Python installed. Do as much as possible with the `clickbait-audio` binary and the TypeScript/JS code in this repo. If a one-off script is needed, write it in JS or TS (use `npx tsx` for TS). Python is fine for internal development tooling that only the maintainer runs, but never for anything on the user's path.

## Project Overview

**clickbAIt** uses an AI-driven interface, audio processing, and a web-based lyrics display to create **show tracks** for cover bands:
- **Click tracks** for timekeeping
- **Spoken section cues** and count-ins ("Verse 2... 1, 2, 3, 4")
- **Backing tracks** from stems, aligned to the click
- **Live lyrics teleprompter** synced to REAPER via OSC

## Technical Direction

- **TypeScript / Node** project for the orchestration, CLI, and teleprompter
- **Rust** for the `clickbait-audio` binary (audio analysis, beat tracking, stem splitting, TTS) — source in `crates/audio/`, prebuilt binary at `.claude/skills/clickbait/bin/clickbait-audio`
- **No Python anywhere on the user path.** Audio feature analysis, OSC sending, file parsing — all of it lives in the Rust binary or TS/JS. If a one-off script is needed, it is written in JS/TS. Python reappearing in user-facing code is a smell: either the binary should grow the feature, or the logic belongs in TS.
- AI features use **Anthropic's Claude** model family (AI chat for song design, BPM detection, structure development). Claude handles the fuzzy/per-song judgment; anything frequent and deterministic gets prebaked into the binary or TS code.
- Initial target DAW: **REAPER** — reads and writes **.rpp files**
- Bi-directional: edits made in REAPER can be recovered and modified in clickbAIt
- Future scope: tighter REAPER integration, other DAW targets, scrolling lyrics/sheet music via mobile apps, MIDI output for equipment control (e.g. digital mixer faders)

## Git Workflow: Human-Attested AI Code

This project follows the **Last Will and Attestament** workflow for AI-generated code (see `../attestament` and `../lastwill` for the tools, though they are not yet production-ready).

**Core rules:**
- All Claude-assisted code goes on a **feature/working branch**, never directly to `main`
- Changes reach `main` only via **pull requests** with human review and attestation of correctness
- All Claude-authored commits must include a `Co-Authored-By` trailer (this is a durable "level 4" signal that survives rebase/squash)
- Human approval on the **exact merge SHA** constitutes attestation — no approving early then pushing more changes

**Branch strategy:**
1. Create a feature branch for AI-assisted work
2. Develop with Claude on the feature branch (commits include Co-Authored-By trailer)
3. Open PR to `main`
4. Human reviews and approves at the final state
5. Merge to `main`

**Why:** Ensures a verifiable human-in-the-loop for all AI-generated code. The goal is transparency and accountability, not bureaucracy.

## Development Approach

**Test-Driven Development (TDD):** Write tests first, then implement. Every new module or feature should start with tests that define the expected behavior before writing the implementation code.

**Human in the loop on tests:** Before writing tests, discuss the test plan with the user. The user should review and agree on what's being tested and why — don't just generate tests and run them. TDD is a thinking tool, not just a code generation pattern. The user's involvement in test design is what keeps the AI-assisted development deliberate rather than reactive.

- `vitest` for TS tests: `npm test` (or `npm run test:watch`)
- `cargo test` for Rust tests in `crates/audio/`
- Tests live in `tests/` (TS) and alongside sources in the Rust crate

## Build Model

**`src/build/song-recipe.ts` is the single definition of the per-song build.** Every song folder's `package.json` wireit block comes from it. Read that file — not the manifests — to answer "how is this made?"

The pipeline has two halves with one human seam:

```
source.m4a → split → lookup → lyrics-txt → beats → align     (analysis)
                    ── author the manifest here ──            (the ONLY human seam)
    <slug>.song.json → smooth → build → bundle                (build)
```

**Authored (human owns it):** `<slug>.song.json` and the song's `package.json` recipe. That's the whole list. In the manifest, the parts that need musical judgment are section names, bar counts, instrumental sections Genius doesn't label, `cue`/`cues`, meter changes, `smStride`, `clips`, and `preRollBars`/`ringOutBars`.

**Derived (never hand-edit; regenerate instead):** stems, `*.lookup.json`, `*.lyrics.txt`, `*.beats.json`, `*.beatmap.json`, `*.align.json`, `*.RPP`, `*.lyrics-display.json`, `cues/**`, `*.opus`.

Alignment has a second production path. KV/multitrack songs (bought as separate instrument tracks) have no demucs split, so `songRecipe` is called with `canAlign: false` and the recipe has no `align` task. They still have vocals — a `lead vocal` track named in `sources.stems.files`. Their `align.json` is generated by `npm run realign-all`, which finds the vocal audio beside `lyrics.alignment.file` (e.g. `kv/lead-vocal.mp3`) and runs desilence-align on it. So `align.json` is always derived; only *which* task derives it changes.

Note the split inside lyrics: the lyric **text** lives in the manifest (nested under its section), but every lyric **timing** is derived from the align sidecar at build. Manual `b`/`t` pins on a lyric line exist only as an escape hatch for when alignment fails.

**`beats` and `init-manifest` are standalone one-shots — never build dependencies.** This is deliberate: `beats` so a hand-tuned tempo window is never silently re-run, and `init-manifest` so a rebuild can't clobber authored sections. `init-manifest` additionally refuses to overwrite an existing manifest unless `CLICKBAIT_SCAFFOLD_FORCE=1`.

**Regenerating everything from manifests** is the build half, and it cannot touch sections or lyrics:

```sh
npm run build:songs             # every changed song → RPP, lyrics-display, cues
npm run build:songs -- bundle   # also render the mix + bundle
```

Wireit content-hashes inputs, so unchanged songs no-op. After changing clickbait's own tool code (not a tracked input), force it: `rm -rf songs/*/*/.wireit`.

**Caveats.**
- `build:songs` only visits folders whose `package.json` has a `wireit` block. A flat folder holding several manifests (e.g. `songs/steely-dan/`, `songs/example-songs/`) is skipped — build those with `npm run generate <manifest>`.
- Recipes are **not uniform**. Songs scaffolded before the recipe grew `beats`/`smooth` still lack those tasks and read `*.beats.json`/`*.beatmap.json` as globs instead. Check the actual recipe before reasoning about a specific song.
- The build needs the Rust binary. `.claude/skills/clickbait/bin/clickbait-audio` is a **symlink into `target/release/`**, so a `cargo clean` silently breaks both the build and `tests/build-rpp.test.ts`. Fix: `cargo build --release -p clickbait-audio` (a from-scratch build takes 10–20 min — it compiles `burn` and `wgpu`).

## Audio Analysis CLI (`clickbait-audio`)

Rust binary at `crates/audio/`. Build with `cargo build` (from repo root or `crates/audio/`).

### Beat detection (`beats` command)

Uses a **DBN (Dynamic Bayesian Network) beat tracker** ported from madmom (Böck et al. 2016, BSD-2). Two-stage pipeline:

1. **Activation function** — converts audio to a 1-D beat-likelihood signal at 100fps
   - `energy` (default): RMS energy envelope derivative. Best for **drum stems**.
   - `spectral-flux`: FFT-based spectral change. Better for full mixes.
2. **DBN Viterbi decoder** — finds the optimal beat sequence given the activation signal. Models tempo as a hidden state, strongly prefers constant tempo.

```sh
# Drum stem (best results)
clickbait-audio beats drums.wav

# Full mix — use spectral-flux and constrain BPM range
clickbait-audio beats mix.mp3 --activation spectral-flux --min-bpm 60 --max-bpm 90

# All options
clickbait-audio beats <file> [--activation energy|spectral-flux] [--min-bpm N] [--max-bpm N]
```

Output: JSON with `beats` array (time, strength) and estimated `bpm`.

**Key insight:** Energy activation on a full mix gives bad results (picks up every transient). For full mixes, use spectral-flux with a BPM hint. For drum stems, energy is simpler and more accurate.

### Other commands

- `analyze` — full-mix + drum-stem onset detection, used for pre-roll measurement and BPM cross-check
- `align` — wav2vec2 CTC forced alignment of known lyrics against a vocal stem (normal path for lyric timing; see `crates/audio/src/align.rs`)
- `transcribe` — Whisper fallback when no published lyrics are available
- `split` — Demucs stem separation (default 4-stem model)
- `lookup` — Deezer / Genius / MusicBrainz metadata fetch
- `speak` — Piper TTS for cue tracks
- `unstretch` — constant-BPM recovery from stretched source audio
- `duration` — quick WAV/MP3/M4A length check

For the user-facing workflow that ties these together, see the clickbait skill (`skill/SKILL.md` — generated, or `skill/SKILL.md.njk` — source) rather than this maintainer guide.

## Prior Art

- **`../Band/cue_maker/`** — Earlier R-based version. Useful for understanding the domain (structure.csv format, section numbering, dual REAPER markers) but not a code model to follow. The RPP format knowledge there is partial; a purpose-built REAPER example project will be the authoritative format reference.

## Project Status

Early stage — second attempt (earlier versions lost).
