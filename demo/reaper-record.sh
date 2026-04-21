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
RPP_FILE="${1:-$(dirname "$DEMO_DIR")/output/setlist/when-the-saints-go-marching-in-louis-armstrong.rpp}"
DURATION="${2:-20}"
OUTPUT_FILE="$OUTPUT_DIR/reaper-demo.mp4"

# Recording region (logical pixels — the window size)
WINDOW_WIDTH=1280
WINDOW_HEIGHT=720
TITLEBAR_HEIGHT=58

# Retina: ffmpeg captures at native resolution, so scale the crop
# Set RETINA_SCALE=2 for Retina displays, 1 for non-Retina
RETINA_SCALE="${RETINA_SCALE:-2}"
CAPTURE_WIDTH=$((WINDOW_WIDTH * RETINA_SCALE))
CAPTURE_HEIGHT=$((WINDOW_HEIGHT * RETINA_SCALE))
CROP_Y=$((TITLEBAR_HEIGHT * RETINA_SCALE))

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
  node -e "
const dgram = require('dgram');
const addr = '/_action/$action_id';
const padLen = 4 - ((addr.length + 1) % 4 || 4);
const addrBuf = Buffer.concat([Buffer.from(addr, 'ascii'), Buffer.alloc(1 + padLen)]);
const tagBuf = Buffer.from(',f\0\0', 'ascii');
const valBuf = Buffer.alloc(4); valBuf.writeFloatBE(1.0, 0);
const msg = Buffer.concat([addrBuf, tagBuf, valBuf]);
const sock = dgram.createSocket('udp4');
sock.send(msg, ${REAPER_OSC_PORT:-8000}, '${REAPER_OSC_HOST:-127.0.0.1}', () => sock.close());
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
          set size of window 1 to {$WINDOW_WIDTH, $((WINDOW_HEIGHT + TITLEBAR_HEIGHT))}
        end try
      end tell
    end tell
  " 2>/dev/null
}

# ── Main ──

info "Opening project in REAPER..."
open -a REAPER "$RPP_FILE"
sleep 5

info "Positioning REAPER window..."
position_reaper
sleep 1

# Keep REAPER in foreground so media doesn't show as offline
osascript -e 'tell application "REAPER" to activate'
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
  -i "2:" \
  -t "$((DURATION + 2))" \
  -vf "crop=${CAPTURE_WIDTH}:${CAPTURE_HEIGHT}:0:${CROP_Y},scale=1280:720" \
  -c:v libx264 -preset ultrafast -crf 23 \
  -pix_fmt yuv420p \
  "$OUTPUT_DIR/_reaper_raw.mp4" 2>/tmp/clickbait-ffmpeg.log &

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
