#!/bin/bash
set -e

cd "$(dirname "$0")/.."

echo "=== Building skill ==="
cargo build --release
npm run dev:skill
npm run dev:bundle

echo ""
echo "=== Populating sandbox ==="
node scripts/setup-sandbox.mjs
