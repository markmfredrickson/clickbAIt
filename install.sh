#!/bin/bash
set -e

# clickbAIt installer — macOS Apple Silicon only
# Usage: curl -fsSL https://raw.githubusercontent.com/markmfredrickson/clickbAIt/main/install.sh | bash

REPO="https://github.com/markmfredrickson/clickbAIt.git"
DIR="clickbAIt"

# --- Platform check ---

OS=$(uname -s)
ARCH=$(uname -m)

if [ "$OS" != "Darwin" ]; then
  echo "This installer is for macOS only."
  echo ""
  echo "For Linux/Windows, clone and build from source:"
  echo "  git clone $REPO && cd $DIR"
  echo "  npm install && cargo build --release"
  echo "  npm run build:skill"
  echo "  See BETA_TEST.md for details."
  exit 1
fi

if [ "$ARCH" != "arm64" ]; then
  echo "Pre-built binaries are Apple Silicon (arm64) only."
  echo "For Intel Macs, clone and build from source:"
  echo ""
  echo "  git clone $REPO && cd $DIR"
  echo "  npm install && cargo build --release"
  echo "  npm run build:skill"
  echo "  target/release/clickbait-audio setup"
  echo "  cp .env.example .env"
  echo ""
  echo "See BETA_TEST.md for details."
  exit 1
fi

# --- Dependency check ---

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install it first:"
  echo "  brew install node"
  exit 1
fi

NODE_MAJOR=$(node --version | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node.js 18+ required (you have $(node --version))."
  echo "  brew upgrade node"
  exit 1
fi

# --- Clone ---

if [ -d "$DIR" ]; then
  echo "Directory $DIR already exists."
  echo "To re-install: rm -rf $DIR && re-run this script."
  exit 1
fi

echo "=== clickbAIt installer ==="
echo ""
echo "Cloning..."
git clone --depth 1 "$REPO"
cd "$DIR"

# --- Hand off to setup.sh ---

echo ""
exec bash setup.sh
