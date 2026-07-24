#!/usr/bin/env bash
# practice.sh — one-shot launcher for a band practice session.
#
# Opens the most recent .rpp in each song directory in REAPER and starts the
# teleprompter serving those same directories (so the browser client sees the
# same songs REAPER is playing).
#
# Usage:
#   scripts/practice.sh <song-dir> [<song-dir> ...]
#   scripts/practice.sh -f <setlist-file> [<song-dir> ...]
#
# Example:
#   scripts/practice.sh songs/aimee-mann songs/the-white-stripes
#   scripts/practice.sh -f local/setlist.txt
#
# A setlist file is one song dir per line, in playing order. Blank lines and
# text from '#' to end-of-line are ignored, so trailing "# Song Title" comments
# are fine. Relative paths in the file resolve against the repo root.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
  echo "Usage: $0 [-f <setlist-file>] [<song-dir> ...]" >&2
  echo "" >&2
  echo "Opens the latest .rpp in each directory in REAPER and starts the" >&2
  echo "teleprompter serving those same directories." >&2
  echo "-f reads song dirs from a setlist file (one per line, # comments ok)." >&2
}

# Collect raw dir arguments from -f files and positional args, in order.
raw_dirs=()
while [ $# -gt 0 ]; do
  case "$1" in
    -f)
      [ $# -ge 2 ] || { echo "Error: -f needs a file argument." >&2; usage; exit 1; }
      file="$2"; shift 2
      [ -f "$file" ] || { echo "Error: no such setlist file: $file" >&2; exit 1; }
      # Strip '#' comments, then read non-blank lines as dirs.
      while IFS= read -r line; do
        line="${line%%#*}"
        line="$(printf '%s' "$line" | xargs)"  # trim surrounding whitespace
        [ -n "$line" ] && raw_dirs+=("$line")
      done < "$file"
      ;;
    -h|--help)
      usage; exit 0
      ;;
    *)
      raw_dirs+=("$1"); shift
      ;;
  esac
done

if [ ${#raw_dirs[@]} -eq 0 ]; then
  usage
  exit 1
fi

# Validate dirs and build teleprompter args in one pass. Relative paths resolve
# against the repo root so a setlist works regardless of the current directory.
tp_args=()
valid_dirs=()
for dir in "${raw_dirs[@]}"; do
  case "$dir" in
    /*) cand="$dir" ;;
    *)  cand="$REPO_ROOT/$dir" ;;
  esac
  abs="$(cd "$cand" 2>/dev/null && pwd)" || { echo "Skip (not a directory): $dir" >&2; continue; }
  valid_dirs+=("$abs")
  tp_args+=(--songs-dir "$abs")
done

if [ ${#valid_dirs[@]} -eq 0 ]; then
  echo "No valid directories provided." >&2
  exit 1
fi

# Open the most recent .rpp in each directory. Case-insensitive match (files
# are .RPP; shell globbing is case-sensitive even on a case-insensitive FS).
for dir in "${valid_dirs[@]}"; do
  matches="$(find "$dir" -maxdepth 1 -iname "*.rpp" 2>/dev/null)"
  if [ -z "$matches" ]; then
    echo "Skip (no .rpp): $dir" >&2
    continue
  fi
  rpp="$(printf '%s\n' "$matches" | tr '\n' '\0' | xargs -0 ls -t | head -1)"
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
