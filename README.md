# clickbAIt

AI-powered tools for creating click, cue, and backing tracks for cover bands.

## Setup

### Prerequisites
- Python 3.12+
- A REAPER installation (for project playback — not needed for generation)

### Install

```bash
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
```

## Usage

```bash
# Run tests
.venv/bin/pytest tests/ -v

# Lint
.venv/bin/ruff check .
```

## Development

This project follows TDD — write tests first, then implement. Tests are in `tests/` and use `pytest`.

All AI-assisted code is developed on feature branches and merged to `main` via pull requests with human review.
