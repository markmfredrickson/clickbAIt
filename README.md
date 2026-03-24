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

### API Keys

Create a `.env` file in the project root. Keys are loaded automatically at startup.

#### Anthropic (required for AI chat)
1. Go to https://console.anthropic.com/
2. Create an account and add billing
3. Go to API Keys → Create Key
4. Add to `.env`:
   ```
   ANTHROPIC_API_KEY=your-key-here
   ```

### Custom System Prompt

The AI assistant's behavior can be customized per project by creating `.clickbait/SYSTEM.md`. If absent, the built-in default is used.

## Usage

```bash
# Start an interactive AI session to design a song project
clickbait chat

# Run tests
.venv/bin/pytest tests/ -v

# Lint
.venv/bin/ruff check .
```

## Development

This project follows TDD — write tests first, then implement. Tests are in `tests/` and use `pytest`.

All AI-assisted code is developed on feature branches and merged to `main` via pull requests with human review.
