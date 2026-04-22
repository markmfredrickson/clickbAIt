#!/bin/bash
set -e

REPO="markmfredrickson/clickbAIt"

echo "=== clickbAIt setup ==="
echo ""

# Node dependencies
echo "Installing Node dependencies..."
npm install

# Fetch latest release tag
echo "Finding latest release..."
LATEST=$(curl -sf "https://api.github.com/repos/$REPO/releases/latest" \
  | grep '"tag_name"' \
  | sed 's/.*"tag_name": "\(.*\)".*/\1/')

if [ -z "$LATEST" ]; then
  echo ""
  echo "No release found. Build from source instead:"
  echo "  cargo build --release"
  echo "  npm run build:skill"
  exit 1
fi

echo "Latest release: $LATEST"

# Download skill bundle (binary + SKILL.md)
BUNDLE_URL="https://github.com/$REPO/releases/download/$LATEST/clickbait-skill-macos-arm64.tar.gz"
echo "Downloading skill bundle..."
curl -fL "$BUNDLE_URL" | tar xz
chmod +x skill/bin/clickbait-audio
echo "  → skill/"

# Install into where Claude Code reads skills
mkdir -p .claude/skills/clickbait/bin
cp skill/SKILL.md .claude/skills/clickbait/SKILL.md
cp skill/bin/clickbait-audio .claude/skills/clickbait/bin/clickbait-audio
echo "  → .claude/skills/clickbait/"

# Piper TTS voice model
VOICE_DIR="$HOME/.cache/clickbait/voices"
VOICE_MODEL="$VOICE_DIR/en_US-lessac-medium.onnx"
if [ ! -f "$VOICE_MODEL" ]; then
  echo "Downloading Piper TTS voice model (~65 MB)..."
  mkdir -p "$VOICE_DIR"
  BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium"
  curl -fL -o "$VOICE_MODEL"       "$BASE/en_US-lessac-medium.onnx"
  curl -fL -o "$VOICE_MODEL.json"  "$BASE/en_US-lessac-medium.onnx.json"
  echo "  → $VOICE_DIR"
else
  echo "TTS voice model already present, skipping."
fi

# Whitelist the binary in Claude Code project settings
if [ ! -f .claude/settings.json ]; then
  mkdir -p .claude
  cat > .claude/settings.json <<'EOF'
{"permissions":{"allow":["Bash(.claude/skills/clickbait/bin/clickbait-audio *)","Bash(mkdir *)"]}}
EOF
  echo "Created .claude/settings.json (binary whitelisted)."
else
  echo ".claude/settings.json already exists, skipping."
fi

# .env
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env — GENIUS_API_TOKEN is optional (free; adds lyrics lookup)."
else
  echo ".env already exists, skipping."
fi

# Warm up demucs GPU (downloads model weights ~84MB, compiles shaders)
echo "Warming up stem splitter (downloads model, compiles GPU shaders — takes a minute)..."
mkdir -p /tmp/clickbait-warmup
.claude/skills/clickbait/bin/clickbait-audio split assets/warmup.wav --output /tmp/clickbait-warmup 2>&1 | grep -v "^$"
rm -rf /tmp/clickbait-warmup
echo "  → GPU ready"

# REAPER OSC config
REAPER_OSC_DIR="$HOME/Library/Application Support/REAPER/OSC"
if [ -d "$REAPER_OSC_DIR" ]; then
  if [ ! -f "$REAPER_OSC_DIR/clickbait.ReaperOSC" ]; then
    cp src/teleprompter/clickbait.ReaperOSC "$REAPER_OSC_DIR/"
    echo "Installed REAPER OSC config."
  else
    echo "REAPER OSC config already installed, skipping."
  fi
fi

echo ""
echo "=== Checking dependencies ==="
bash scripts/check-deps.sh

echo ""
echo "=== Done ==="
echo ""
echo "Next steps:"
echo "  1. (Optional) Edit .env and add GENIUS_API_TOKEN for lyrics lookup"
echo "  2. Open this directory in Claude Code"
echo "  3. Run /clickbait to build your first song"
echo ""
