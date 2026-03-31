#!/bin/bash
set -e

cd "$(dirname "$0")/.."

echo "=== Building skill ==="
cargo build --release
npm run build:skill

echo ""
echo "=== Populating sandbox ==="
node scripts/setup-sandbox.mjs
