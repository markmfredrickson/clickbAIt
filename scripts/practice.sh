#!/usr/bin/env bash
# practice.sh — one-shot launcher for a band practice session.
#
# Opens the most recent .rpp in each song directory in REAPER and starts the
# teleprompter serving those same directories (so the browser client sees the
# same songs REAPER is playing).
#
# Usage:
#   scripts/practice.sh <song-dir> [<song-dir> ...]
#
# Example:
#   scripts/practice.sh songs/aimee-mann songs/the-white-stripes

set -euo pipefail

if [ $# -eq 0 ]; then
  echo "Usage: $0 <song-dir> [<song-dir> ...]" >&2
  echo "" >&2
  echo "Opens the latest .rpp in each directory in REAPER and starts the" >&2
  echo "teleprompter serving those same directories." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Collect dirs, validate, and build teleprompter args in one pass
tp_args=()
valid_dirs=()
for dir in "$@"; do
  abs="$(cd "$dir" 2>/dev/null && pwd)" || { echo "Skip (not a directory): $dir" >&2; continue; }
  valid_dirs+=("$abs")
  tp_args+=(--songs-dir "$abs")
done

if [ ${#valid_dirs[@]} -eq 0 ]; then
  echo "No valid directories provided." >&2
  exit 1
fi

# Open the most recent .rpp in each directory
for dir in "${valid_dirs[@]}"; do
  rpp="$(ls -t "$dir"/*.rpp 2>/dev/null | head -1 || true)"
  if [ -z "$rpp" ]; then
    echo "Skip (no .rpp): $dir" >&2
    continue
  fi
  echo "REAPER: $rpp"
  open "$rpp"
done

# Free port 9000 (OSC) if an old teleprompter is holding it
if lsof -iUDP:9000 -t >/dev/null 2>&1; then
  echo "Killing existing teleprompter on UDP:9000..."
  lsof -iUDP:9000 -t | xargs kill 2>/dev/null || true
  sleep 1
fi

echo ""
echo "Starting teleprompter (Ctrl-C to stop)..."
cd "$REPO_ROOT"
exec npx tsx scripts/teleprompter.ts "${tp_args[@]}"
