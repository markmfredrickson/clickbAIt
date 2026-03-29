#!/usr/bin/env bash
#
# Record REAPER + teleprompter side-by-side demo
#
# Shows: QR join page → song loads → switch to lyrics → scrolling with REAPER
#
# Usage: ./demo/record-combo.sh [project.rpp] [duration_seconds]
#
set -uo pipefail

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

# Auto-detect screen capture device
SCREEN_DEV=$(ffmpeg -f avfoundation -list_devices true -i "" 2>&1 | grep -i "capture screen" | head -1 | sed 's/.*\[\([0-9]*\)\].*/\1/')
SCREEN_DEV="${SCREEN_DEV:-2}"

# ── Confirmation ──
echo ""
echo "  Demo recording setup:"
echo "    RPP:      $(basename "$RPP_FILE")"
echo "    Duration: ${DURATION}s"
echo "    Screen:   device $SCREEN_DEV"
echo "    Layout:   REAPER (left) + Browser (right)"
echo ""
echo "  This will:"
echo "    1. Start the teleprompter server"
echo "    2. Open the QR join page in a new browser window"
echo "    3. Open the RPP in REAPER"
echo "    4. Position both windows side-by-side"
echo "    5. Start recording, play the song"
echo "    6. Switch browser to lyrics view mid-recording"
echo ""
read -p "  Ready? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "  Cancelled."
  exit 0
fi

# ── Start teleprompter ──
info "Starting teleprompter server..."
npx tsx "$PROJECT_ROOT/scripts/teleprompter.ts" --songs-dir "$SONGS_DIR" &
TELEPROMPTER_PID=$!
sleep 3

cleanup() {
  kill "$TELEPROMPTER_PID" 2>/dev/null || true
}
trap cleanup EXIT

# ── Open QR join page in a new window ──
info "Opening QR join page..."
osascript -e '
  tell application "Brave Browser"
    make new window
    set URL of active tab of front window to "http://localhost:3000/"
  end tell
' 2>/dev/null || open "http://localhost:3000/"
sleep 2

# ── Open REAPER with the project ──
info "Opening project in REAPER..."
open -a REAPER "$RPP_FILE"
sleep 4

# ── Position windows side by side ──
info "Positioning windows..."

# REAPER: left half
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

# Browser: right half
sleep 0.5
osascript -e "
  tell application \"Brave Browser\" to activate
  delay 0.3
  tell application \"System Events\"
    tell process \"Brave Browser\"
      set position of front window to {$HALF_WIDTH, 0}
      set size of front window to {$HALF_WIDTH, $((WINDOW_HEIGHT + TITLEBAR_HEIGHT))}
    end tell
  end tell
" 2>/dev/null

sleep 1

# ── Go to start ──
osascript -e 'tell application "REAPER" to activate' \
  -e 'tell application "System Events" to key code 115'
sleep 0.5

# ── Check with user ──
echo ""
echo "  Windows should now be positioned:"
echo "    Left:  REAPER with $(basename "$RPP_FILE")"
echo "    Right: QR join page"
echo ""
read -p "  Look good? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "  Cancelled. Adjust windows manually and try again."
  exit 0
fi

# ── Bring windows to front before recording ──
osascript -e 'tell application "Brave Browser" to activate' 2>/dev/null
sleep 0.3
osascript -e 'tell application "REAPER" to activate' 2>/dev/null
sleep 0.3

# ── Start screen recording ──
info "Recording (${DURATION}s)..."
ffmpeg -y \
  -f avfoundation \
  -framerate 30 \
  -capture_cursor 0 \
  -i "${SCREEN_DEV}:" \
  -t "$((DURATION + 2))" \
  -vf "crop=${CAPTURE_WIDTH}:${CAPTURE_HEIGHT}:0:${CROP_Y},scale=1280:720" \
  -c:v libx264 -preset ultrafast -crf 23 \
  -pix_fmt yuv420p \
  "$OUTPUT_DIR/_combo_raw.mp4" 2>/tmp/clickbait-ffmpeg.log &

FFMPEG_PID=$!
sleep 1

# ── Act 1: Start REAPER playback, QR page visible (5s) ──
info "Act 1: Playing — QR join page showing..."
osascript -e 'tell application "REAPER" to activate' \
  -e 'tell application "System Events" to keystroke " "'
sleep 5

# ── Act 2: Switch browser to lyrics view ──
info "Act 2: Switching to lyrics..."
osascript -e '
  tell application "Brave Browser"
    activate
    set URL of active tab of front window to "http://localhost:3000/lyrics"
  end tell
' 2>/dev/null
sleep $((DURATION - 8))

# ── Stop ──
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

ok "Combined screencast: $OUTPUT_FILE"
