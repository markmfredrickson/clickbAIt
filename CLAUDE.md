# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working Style

**Don't race ahead.** The user communicates in short messages. Multiple messages may be part of one thought. Do NOT immediately edit files or run commands after each message. Wait until it's clear the user is done and you understand the full picture before acting. When in doubt, ask.

## Project Overview

**clickbAIt** uses an AI-driven interface, audio processing, and a web-based lyrics display to create **show tracks** for cover bands:
- **Click tracks** for timekeeping
- **Spoken section cues** and count-ins ("Verse 2... 1, 2, 3, 4")
- **Backing tracks** from stems, aligned to the click
- **Live lyrics teleprompter** synced to REAPER via OSC

## Technical Direction

- **Python** project — uses existing libraries for REAPER's RPP format
- AI features use **Anthropic's Claude** model family (AI chat for song design, BPM detection, structure development)
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

- `pytest` for testing: ``.venv/bin/pytest tests/ -v``
- `ruff` for linting: ``.venv/bin/ruff check .``
- Tests live in `tests/` mirroring the package structure
- Coverage: ``.venv/bin/pytest tests/ --cov=clickbait --cov-report=term-missing``

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

### Legacy commands

- `analyze` — old spectral flux onset detection + naive BPM estimation (being replaced)
- `duration`, `transcribe`, `lookup`, `unstretch`, `split`, `speak` — other audio tools

## Prior Art

- **`../Band/cue_maker/`** — Earlier R-based version. Useful for understanding the domain (structure.csv format, section numbering, dual REAPER markers) but not a code model to follow. The RPP format knowledge there is partial; a purpose-built REAPER example project will be the authoritative format reference.

## Project Status

Early stage — second attempt (earlier versions lost). Planning notes in `notes.md`.
