#!/usr/bin/env bash
#
# Record REAPER playing a clickbAIt project
#
# Opens a .rpp file in REAPER, positions the window, starts playback,
# records the screen region for a set duration, then stops.
#
# Usage: ./demo/reaper-record.sh [project.rpp] [duration_seconds]
#
# Prerequisites: REAPER installed, ffmpeg with avfoundation
#
set -euo pipefail

DEMO_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="$DEMO_DIR/output"
mkdir -p "$OUTPUT_DIR"

# ── Config ──
# Default to When the Saints Go Marching In (public domain, always available)
RPP_FILE="${1:-$(dirname "$DEMO_DIR")/output/setlist/when-the-saints-go-marching-in-traditional.rpp}"
DURATION="${2:-20}"
OUTPUT_FILE="$OUTPUT_DIR/reaper-demo.mp4"

# Recording region (adjust for your display — these are logical pixels)
# Default: 1280x720 capture from top-left of REAPER window
CAPTURE_WIDTH=1280
CAPTURE_HEIGHT=720

# REAPER actions (built-in command IDs)
ACTION_PLAY=1007
ACTION_STOP=1016
ACTION_GO_TO_START=40042

# ── Colors ──
CYAN='\033[0;36m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${CYAN}▶${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
error() { echo -e "${RED}✗${NC} $*" >&2; }

if [[ ! -f "$RPP_FILE" ]]; then
  error "File not found: $RPP_FILE"
  exit 1
fi

# ── Helper: send REAPER action via AppleScript ──
reaper_action() {
  local action_id="$1"
  osascript -e "
    tell application \"REAPER\"
      activate
    end tell
    tell application \"System Events\"
      tell process \"REAPER\"
        -- REAPER actions can be triggered via menu or keystroke
        -- We use the SWS extension's command line if available,
        -- otherwise fall back to OSC
      end tell
    end tell
  " 2>/dev/null || true
}

# ── Helper: send REAPER action via OSC (more reliable) ──
send_osc_action() {
  local action_id="$1"
  # REAPER listens for OSC on configurable port (default 8000)
  # Send /_action/{id} with value 1.0
  python3 -c "
import socket, struct
addr = '/_action/$action_id\x00'
addr_padded = addr + '\x00' * (4 - len(addr) % 4)
tag = ',f\x00\x00'
val = struct.pack('>f', 1.0)
msg = addr_padded.encode('ascii') + tag.encode('ascii') + val
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.sendto(msg, ('${REAPER_OSC_HOST:-127.0.0.1}', ${REAPER_OSC_PORT:-8000}))
sock.close()
" 2>/dev/null || true
}

# ── Helper: position and resize REAPER window ──
position_reaper() {
  osascript -e "
    tell application \"REAPER\"
      activate
    end tell
    delay 0.5
    tell application \"System Events\"
      tell process \"REAPER\"
        try
          set position of window 1 to {0, 0}
          set size of window 1 to {$CAPTURE_WIDTH, $CAPTURE_HEIGHT}
        end try
      end tell
    end tell
  " 2>/dev/null
}

# ── Main ──

info "Opening project in REAPER..."
open -a REAPER "$RPP_FILE"
sleep 3

info "Positioning REAPER window..."
position_reaper
sleep 1

info "Going to start of project..."
# REAPER: Home key = go to start of project
osascript -e 'tell application "REAPER" to activate' -e 'tell application "System Events" to key code 115'
sleep 0.5

info "Starting screen recording (${DURATION}s)..."

# Get REAPER window position for cropped capture
# We record the full screen and crop — more reliable than coordinate-based capture
ffmpeg -y \
  -f avfoundation \
  -framerate 30 \
  -capture_cursor 1 \
  -i "3:" \
  -t "$((DURATION + 2))" \
  -vf "crop=${CAPTURE_WIDTH}:${CAPTURE_HEIGHT}:0:0" \
  -c:v libx264 -preset ultrafast -crf 23 \
  -pix_fmt yuv420p \
  "$OUTPUT_DIR/_reaper_raw.mp4" 2>/dev/null &

FFMPEG_PID=$!
sleep 1

info "Starting REAPER playback..."
# REAPER: Space = play/stop
osascript -e 'tell application "REAPER" to activate' -e 'tell application "System Events" to keystroke " "'

# Wait for recording duration
sleep "$DURATION"

info "Stopping playback..."
osascript -e 'tell application "REAPER" to activate' -e 'tell application "System Events" to keystroke " "'

# Let the recording finish gracefully
sleep 1
kill "$FFMPEG_PID" 2>/dev/null || true
wait "$FFMPEG_PID" 2>/dev/null || true

# Re-encode with better compression
info "Encoding final video..."
ffmpeg -y -i "$OUTPUT_DIR/_reaper_raw.mp4" \
  -c:v libx264 -preset medium -crf 23 \
  -pix_fmt yuv420p \
  "$OUTPUT_FILE" 2>/dev/null

rm -f "$OUTPUT_DIR/_reaper_raw.mp4"

ok "REAPER screencast: $OUTPUT_FILE"
