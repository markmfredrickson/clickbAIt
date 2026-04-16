#!/bin/bash
# Check that all clickbAIt skill dependencies are present.
# Exits 0 if everything is good, 1 if anything is missing.

cd "$(dirname "$0")/.."

OK=true
WARN=false

check() {
  local label="$1"
  local ok="$2"
  local hint="$3"
  if [ "$ok" = "true" ]; then
    echo "  ✓ $label"
  else
    echo "  ✗ $label"
    echo "    → $hint"
    OK=false
  fi
}

warn() {
  local label="$1"
  local ok="$2"
  local hint="$3"
  if [ "$ok" = "true" ]; then
    echo "  ✓ $label"
  else
    echo "  ~ $label (optional)"
    echo "    → $hint"
    WARN=true
  fi
}

echo "=== clickbAIt dependency check ==="
echo ""

# --- Required ---
echo "Required:"

check "clickbait-audio binary" \
  "$([ -x .claude/skills/clickbait/bin/clickbait-audio ] && echo true || echo false)" \
  "Run setup.sh to download the binary"

VOICE="$HOME/.cache/clickbait/voices/en_US-lessac-medium.onnx"
check "Piper TTS voice model" \
  "$([ -f "$VOICE" ] && echo true || echo false)" \
  "Run setup.sh to download the voice model"

check ".env with ANTHROPIC_API_KEY" \
  "$([ -f .env ] && grep -q 'ANTHROPIC_API_KEY=.' .env && echo true || echo false)" \
  "Copy .env.example to .env and add your key"

echo ""
echo "Optional:"

WHISPER_DIR="$HOME/.cache/clickbait/models"
WHISPER_FOUND=$(ls "$WHISPER_DIR"/ggml-*.bin 2>/dev/null | head -1)
warn "Whisper model" \
  "$([ -n "$WHISPER_FOUND" ] && echo true || echo false)" \
  "The skill will prompt to download on first transcribe"

warn "Node.js 18+" \
  "$(node --version 2>/dev/null | grep -qE 'v(1[89]|[2-9][0-9])' && echo true || echo false)" \
  "Install: https://nodejs.org"

echo ""
if [ "$OK" = "true" ]; then
  echo "All required dependencies present."
  exit 0
else
  echo "Some required dependencies are missing. Run setup.sh to install them."
  exit 1
fi
