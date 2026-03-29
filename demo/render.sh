#!/usr/bin/env bash
#
# Render the clickbAIt demo screencast
#
# Composes Playwright browser recording + VHS terminal recording into
# a single demo video with title cards.
#
# Usage: ./demo/render.sh [--browser-only] [--cli-only] [--reaper-only] [--all]
#
# Prerequisites:
#   brew install ffmpeg charmbracelet/tap/vhs
#   npx playwright install chromium
#   REAPER installed at /Applications/REAPER.app (for --reaper-only/--all)
#
set -euo pipefail

DEMO_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="$DEMO_DIR/output"
mkdir -p "$OUTPUT_DIR"

MODE="${1:---all}"

# ── Colors ──
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}▶${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
error() { echo -e "${RED}✗${NC} $*" >&2; }

# ── Record browser screencast ──
record_browser() {
  info "Recording teleprompter screencast with Playwright..."

  npx playwright test --config "$DEMO_DIR/playwright.config.ts" 2>&1 || true

  # Playwright saves video in output dir — find the latest webm
  BROWSER_VIDEO=$(find "$OUTPUT_DIR" -name "*.webm" -newer "$DEMO_DIR/teleprompter.spec.ts" | head -1)

  if [[ -z "$BROWSER_VIDEO" ]]; then
    error "No Playwright video found. Check test output above."
    return 1
  fi

  # Convert to mp4 for wider compatibility
  ffmpeg -y -i "$BROWSER_VIDEO" \
    -c:v libx264 -preset medium -crf 23 \
    -pix_fmt yuv420p \
    "$OUTPUT_DIR/teleprompter-demo.mp4" 2>/dev/null

  ok "Browser screencast: $OUTPUT_DIR/teleprompter-demo.mp4"
}

# ── Record REAPER screencast ──
record_reaper() {
  info "Recording REAPER playback..."

  if [[ "$(uname)" != "Darwin" ]]; then
    error "REAPER recording requires macOS (uses avfoundation + AppleScript)"
    return 1
  fi

  if ! ls /Applications/REAPER*.app &>/dev/null; then
    error "REAPER not found in /Applications"
    return 1
  fi

  # Default: When the Saints Go Marching In (public domain)
  local rpp_file="${REAPER_RPP:-$(dirname "$DEMO_DIR")/output/saints/when-the-saints-go-marching-in-traditional.rpp}"

  "$DEMO_DIR/reaper-record.sh" "$rpp_file" "${REAPER_DURATION:-20}"

  ok "REAPER screencast: $OUTPUT_DIR/reaper-demo.mp4"
}

# ── Record CLI screencast ──
record_cli() {
  info "Recording CLI demo with VHS..."

  if ! command -v vhs &>/dev/null; then
    error "VHS not installed. Install with: brew install charmbracelet/tap/vhs"
    return 1
  fi

  vhs "$DEMO_DIR/cli.tape" 2>&1

  ok "CLI screencast: $OUTPUT_DIR/cli-demo.mp4"
}

# ── Compose final video ──
compose() {
  info "Composing final screencast..."

  local inputs=()
  local filter_parts=()
  local idx=0

  # Title card: 3 seconds of text on dark background
  ffmpeg -y -f lavfi \
    -i "color=c=0x1e1e2e:s=1280x720:d=3" \
    -vf "drawtext=text='clickbAIt':fontsize=72:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2-40, \
         drawtext=text='AI-powered click, cue & backing tracks':fontsize=28:fontcolor=0xcdd6f4:x=(w-text_w)/2:y=(h-text_h)/2+40" \
    -c:v libx264 -pix_fmt yuv420p \
    "$OUTPUT_DIR/_title.mp4" 2>/dev/null

  inputs+=("-i" "$OUTPUT_DIR/_title.mp4")
  filter_parts+=("[$idx:v]setpts=PTS-STARTPTS[v$idx]")
  idx=$((idx + 1))

  # Add REAPER demo if it exists (show this first — it's the DAW)
  if [[ -f "$OUTPUT_DIR/reaper-demo.mp4" ]]; then
    ffmpeg -y -f lavfi \
      -i "color=c=0x1e1e2e:s=1280x720:d=2" \
      -vf "drawtext=text='REAPER Project Playback':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2" \
      -c:v libx264 -pix_fmt yuv420p \
      "$OUTPUT_DIR/_reaper_card.mp4" 2>/dev/null

    inputs+=("-i" "$OUTPUT_DIR/_reaper_card.mp4")
    filter_parts+=("[$idx:v]setpts=PTS-STARTPTS[v$idx]")
    idx=$((idx + 1))

    inputs+=("-i" "$OUTPUT_DIR/reaper-demo.mp4")
    filter_parts+=("[$idx:v]setpts=PTS-STARTPTS,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2[v$idx]")
    idx=$((idx + 1))
  fi

  # Add browser demo if it exists
  if [[ -f "$OUTPUT_DIR/teleprompter-demo.mp4" ]]; then
    # Section card
    ffmpeg -y -f lavfi \
      -i "color=c=0x1e1e2e:s=1280x720:d=2" \
      -vf "drawtext=text='Live Teleprompter':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2" \
      -c:v libx264 -pix_fmt yuv420p \
      "$OUTPUT_DIR/_teleprompter_card.mp4" 2>/dev/null

    inputs+=("-i" "$OUTPUT_DIR/_teleprompter_card.mp4")
    filter_parts+=("[$idx:v]setpts=PTS-STARTPTS[v$idx]")
    idx=$((idx + 1))

    inputs+=("-i" "$OUTPUT_DIR/teleprompter-demo.mp4")
    filter_parts+=("[$idx:v]setpts=PTS-STARTPTS,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2[v$idx]")
    idx=$((idx + 1))
  fi

  # Add CLI demo if it exists
  if [[ -f "$OUTPUT_DIR/cli-demo.mp4" ]]; then
    # Section card
    ffmpeg -y -f lavfi \
      -i "color=c=0x1e1e2e:s=1280x720:d=2" \
      -vf "drawtext=text='Command Line Tools':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2" \
      -c:v libx264 -pix_fmt yuv420p \
      "$OUTPUT_DIR/_cli_card.mp4" 2>/dev/null

    inputs+=("-i" "$OUTPUT_DIR/_cli_card.mp4")
    filter_parts+=("[$idx:v]setpts=PTS-STARTPTS[v$idx]")
    idx=$((idx + 1))

    inputs+=("-i" "$OUTPUT_DIR/cli-demo.mp4")
    filter_parts+=("[$idx:v]setpts=PTS-STARTPTS,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2[v$idx]")
    idx=$((idx + 1))
  fi

  if [[ $idx -lt 2 ]]; then
    error "Need at least one demo recording to compose. Run with --all first."
    return 1
  fi

  # Build concat filter
  local concat_inputs=""
  for ((i=0; i<idx; i++)); do
    concat_inputs+="[v$i]"
  done

  local filter_complex="$(IFS=';'; echo "${filter_parts[*]}");${concat_inputs}concat=n=$idx:v=1:a=0[out]"

  ffmpeg -y "${inputs[@]}" \
    -filter_complex "$filter_complex" \
    -map "[out]" \
    -c:v libx264 -preset medium -crf 23 \
    -pix_fmt yuv420p \
    "$OUTPUT_DIR/clickbait-demo.mp4" 2>/dev/null

  # Clean up intermediates
  rm -f "$OUTPUT_DIR"/_*.mp4

  ok "Final screencast: $OUTPUT_DIR/clickbait-demo.mp4"
}

# ── Main ──
case "$MODE" in
  --browser-only)
    record_browser
    ;;
  --cli-only)
    record_cli
    ;;
  --reaper-only)
    record_reaper
    ;;
  --all)
    record_reaper || true
    record_browser || true
    record_cli || true
    compose
    ;;
  *)
    echo "Usage: $0 [--browser-only] [--cli-only] [--reaper-only] [--all]"
    exit 1
    ;;
esac
