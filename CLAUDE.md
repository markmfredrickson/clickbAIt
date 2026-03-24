# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**clickbAIt** — AI-powered tools for creating click, cue, and backing tracks for cover bands.

The tool automates the workflow of producing DAW projects containing:
- **Click tracks** for timekeeping
- **Vocal cues** signaling section changes (verse, chorus, bridge, etc.)
- **Backing tracks** for practice or filling missing parts during performance

The traditional manual process involves: finding BPM, mapping song structure by ear, creating a DAW project, generating cue audio, importing/time-aligning backing tracks (possibly from stem-split sources), and exporting for band use.

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

- `pytest` for testing: ``.venv/bin/pytest tests/ -v``
- `ruff` for linting: ``.venv/bin/ruff check .``
- Tests live in `tests/` mirroring the package structure

## Prior Art

- **`../Band/cue_maker/`** — Earlier R-based version. Useful for understanding the domain (structure.csv format, section numbering, dual REAPER markers) but not a code model to follow. The RPP format knowledge there is partial; a purpose-built REAPER example project will be the authoritative format reference.

## Project Status

Early stage — second attempt (earlier versions lost). Planning notes in `notes.md`.
