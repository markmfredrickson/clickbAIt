#!/usr/bin/env bash
#
# Build a song from a .prompt file
#
# Usage: ./scripts/build-song.sh songs/traditional/when-the-saints-go-marching-in.prompt [output-dir]
#
# The .prompt file contains the user's instructions to Claude.
# Claude generates the .ts DSongL file, then generate.ts builds the RPP.
#
set -euo pipefail

PROMPT_FILE="${1:?Usage: $0 <song.prompt> [output-dir]}"
OUTPUT_DIR="${2:-output/setlist}"

if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "File not found: $PROMPT_FILE" >&2
  exit 1
fi

# Derive the .ts path from the .prompt path
TS_FILE="${PROMPT_FILE%.prompt}.ts"
SONG_DIR="$(dirname "$PROMPT_FILE")"
SONG_NAME="$(basename "$PROMPT_FILE" .prompt)"

echo "Building: $SONG_NAME"
echo "  Prompt: $PROMPT_FILE"
echo "  Output: $OUTPUT_DIR"
echo ""

# Step 1: Generate the DSongL .ts file via Claude
if [[ -f "$TS_FILE" ]]; then
  echo "  Song file exists: $TS_FILE (skipping Claude, use -f to force)"
  if [[ "${3:-}" != "-f" ]]; then
    # Skip to generation
    echo ""
    echo "  Generating REAPER project..."
    npx tsx src/generate.ts "$TS_FILE" "$OUTPUT_DIR"
    exit 0
  fi
fi

echo "  Running Claude to generate DSongL..."
PROMPT="$(cat "$PROMPT_FILE")"
claude -p "$PROMPT" --allowedTools 'Bash(target/debug/clickbait-audio *)' 'Bash(npx tsx src/generate.ts *)' Read Write Glob

# Step 2: Check that Claude created the .ts file
if [[ ! -f "$TS_FILE" ]]; then
  # Claude might have put it somewhere else — search all of songs/
  FOUND=$(find songs/ -name "*.ts" -newer "$PROMPT_FILE" 2>/dev/null | head -1)
  if [[ -n "$FOUND" ]]; then
    TS_FILE="$FOUND"
    echo "  Found generated file: $TS_FILE"
  else
    echo "  Error: Claude did not generate a .ts file" >&2
    exit 1
  fi
fi

# Step 3: Generate RPP + teleprompter JSON
echo ""
echo "  Generating REAPER project..."
npx tsx src/generate.ts "$TS_FILE" "$OUTPUT_DIR"
