#!/usr/bin/env bash
#
# Record REAPER + teleprompter side-by-side
#
# Positions REAPER on the left half and a browser on the right half,
# starts the teleprompter server, opens the lyrics page, then captures
# the full screen while REAPER drives playback via OSC.
#
# Usage: ./demo/record-combo.sh [project.rpp] [duration_seconds]
#
set -euo pipefail

DEMO_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$DEMO_DIR")"
OUTPUT_DIR="$DEMO_DIR/output"
mkdir -p "$OUTPUT_DIR"

RPP_FILE="${1:-$PROJECT_ROOT/output/setlist/when-the-saints-go-marching-in-traditional.rpp}"
DURATION="${2:-30}"
OUTPUT_FILE="$OUTPUT_DIR/combo-demo.mp4"
SONGS_DIR="$(dirname "$RPP_FILE")"

# Window layout (logical pixels)
HALF_WIDTH=640
WINDOW_HEIGHT=720
TITLEBAR_HEIGHT=58

# Retina scaling
RETINA_SCALE="${RETINA_SCALE:-2}"
CAPTURE_WIDTH=$((HALF_WIDTH * 2 * RETINA_SCALE))
CAPTURE_HEIGHT=$((WINDOW_HEIGHT * RETINA_SCALE))
CROP_Y=$((TITLEBAR_HEIGHT * RETINA_SCALE))

# Colors
info()  { echo -e "\033[0;36m▶\033[0m $*"; }
ok()    { echo -e "\033[0;32m✓\033[0m $*"; }
error() { echo -e "\033[0;31m✗\033[0m $*" >&2; }

if [[ ! -f "$RPP_FILE" ]]; then
  error "File not found: $RPP_FILE"
  exit 1
fi

# ── Start teleprompter server ──
info "Starting teleprompter server..."
npx tsx "$PROJECT_ROOT/scripts/teleprompter.ts" --songs-dir "$SONGS_DIR" &
TELEPROMPTER_PID=$!
sleep 3

# ── Open browser to lyrics page ──
info "Opening browser..."
open "http://localhost:3000/lyrics"
sleep 2

# ── Position windows side by side ──
info "Positioning windows..."

# REAPER: left half
open -a REAPER "$RPP_FILE"
sleep 3

osascript -e "
  tell application \"REAPER\" to activate
  delay 0.3
  tell application \"System Events\"
    tell process \"REAPER\"
      try
        set position of window 1 to {0, 0}
        set size of window 1 to {$HALF_WIDTH, $((WINDOW_HEIGHT + TITLEBAR_HEIGHT))}
      end try
    end tell
  end tell
" 2>/dev/null

# Browser: right half (find Chrome/Brave/Safari)
sleep 1
osascript -e "
  -- Try common browsers
  set browserFound to false

  try
    tell application \"Brave Browser\"
      activate
    end tell
    delay 0.3
    tell application \"System Events\"
      tell process \"Brave Browser\"
        set position of window 1 to {$HALF_WIDTH, 0}
        set size of window 1 to {$HALF_WIDTH, $((WINDOW_HEIGHT + TITLEBAR_HEIGHT))}
      end tell
    end tell
    set browserFound to true
  end try

  if not browserFound then
    try
      tell application \"Google Chrome\"
        activate
      end tell
      delay 0.3
      tell application \"System Events\"
        tell process \"Google Chrome\"
          set position of window 1 to {$HALF_WIDTH, 0}
          set size of window 1 to {$HALF_WIDTH, $((WINDOW_HEIGHT + TITLEBAR_HEIGHT))}
        end tell
      end tell
      set browserFound to true
    end try
  end if

  if not browserFound then
    try
      tell application \"Safari\"
        activate
      end tell
      delay 0.3
      tell application \"System Events\"
        tell process \"Safari\"
          set position of window 1 to {$HALF_WIDTH, 0}
          set size of window 1 to {$HALF_WIDTH, $((WINDOW_HEIGHT + TITLEBAR_HEIGHT))}
        end tell
      end tell
    end try
  end if
" 2>/dev/null

sleep 1

# ── Go to start and start recording ──
info "Going to start of project..."
osascript -e 'tell application "REAPER" to activate' \
  -e 'tell application "System Events" to key code 115'
sleep 0.5

info "Recording side-by-side (${DURATION}s)..."
ffmpeg -y \
  -f avfoundation \
  -framerate 30 \
  -capture_cursor 0 \
  -i "2:" \
  -t "$((DURATION + 2))" \
  -vf "crop=${CAPTURE_WIDTH}:${CAPTURE_HEIGHT}:0:${CROP_Y},scale=1280:720" \
  -c:v libx264 -preset ultrafast -crf 23 \
  -pix_fmt yuv420p \
  "$OUTPUT_DIR/_combo_raw.mp4" 2>/tmp/clickbait-ffmpeg.log &

FFMPEG_PID=$!
sleep 1

info "Starting REAPER playback..."
osascript -e 'tell application "REAPER" to activate' \
  -e 'tell application "System Events" to keystroke " "'

sleep "$DURATION"

info "Stopping playback..."
osascript -e 'tell application "REAPER" to activate' \
  -e 'tell application "System Events" to keystroke " "'

sleep 1
kill "$FFMPEG_PID" 2>/dev/null || true
wait "$FFMPEG_PID" 2>/dev/null || true

# Re-encode
info "Encoding final video..."
ffmpeg -y -i "$OUTPUT_DIR/_combo_raw.mp4" \
  -c:v libx264 -preset medium -crf 23 \
  -pix_fmt yuv420p \
  "$OUTPUT_FILE" 2>/dev/null

rm -f "$OUTPUT_DIR/_combo_raw.mp4"

# Clean up teleprompter
kill "$TELEPROMPTER_PID" 2>/dev/null || true

ok "Combined screencast: $OUTPUT_FILE"
