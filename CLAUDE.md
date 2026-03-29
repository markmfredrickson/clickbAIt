# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

## Prior Art

- **`../Band/cue_maker/`** — Earlier R-based version. Useful for understanding the domain (structure.csv format, section numbering, dual REAPER markers) but not a code model to follow. The RPP format knowledge there is partial; a purpose-built REAPER example project will be the authoritative format reference.

## Project Status

Early stage — second attempt (earlier versions lost). Planning notes in `notes.md`.
