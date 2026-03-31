#!/usr/bin/env node
/**
 * Populate sandbox/ with built artifacts, simulating a fresh beta user install.
 *
 * Copies (not symlinks) so the sandbox is a true snapshot of what a user gets.
 * Re-run after any build to refresh.
 *
 * Usage: node scripts/setup-sandbox.mjs
 */

import { copyFileSync, mkdirSync, existsSync, cpSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const sandbox = resolve(root, "sandbox");

function dir(p) {
  mkdirSync(p, { recursive: true });
}

function copy(src, dest) {
  const s = resolve(root, src);
  const d = resolve(sandbox, dest);
  if (!existsSync(s)) {
    console.warn(`  SKIP (not found): ${src}`);
    return;
  }
  dir(resolve(d, ".."));
  copyFileSync(s, d);
  console.log(`  ${src} → sandbox/${dest}`);
}

function copyDir(src, dest) {
  const s = resolve(root, src);
  const d = resolve(sandbox, dest);
  if (!existsSync(s)) {
    console.warn(`  SKIP (not found): ${src}`);
    return;
  }
  cpSync(s, d, { recursive: true });
  console.log(`  ${src}/ → sandbox/${dest}/`);
}

console.log("=== Populating sandbox ===\n");

// Skill docs and generated SKILL.md
copyDir("skill", "skill");
copy(".claude/skills/clickbait/SKILL.md", ".claude/skills/clickbait/SKILL.md");

// Binary (prefer release, fall back to debug)
const releaseBin = "skill/bin/clickbait-audio";
const releaseFallback = "target/release/clickbait-audio";
const debugFallback = "target/debug/clickbait-audio";

if (existsSync(resolve(root, releaseBin))) {
  copy(releaseBin, "skill/bin/clickbait-audio");
} else if (existsSync(resolve(root, releaseFallback))) {
  console.log("  (skill/bin not populated — using target/release)");
  copy(releaseFallback, "skill/bin/clickbait-audio");
} else if (existsSync(resolve(root, debugFallback))) {
  console.log("  (skill/bin not populated — using target/debug)");
  copy(debugFallback, "skill/bin/clickbait-audio");
} else {
  console.warn("  SKIP binary (run `cargo build --release` first)");
}

// Env
if (existsSync(resolve(root, ".env"))) {
  copy(".env", ".env");
} else {
  copy(".env.example", ".env");
  console.log("  (.env not found — copied .env.example; add your API key)");
}

// Empty songs dir
dir(resolve(sandbox, "songs"));
console.log("  songs/ (empty)");

// Pre-whitelist the binary so the sandbox doesn't prompt
const settingsPath = resolve(sandbox, ".claude/settings.json");
dir(resolve(sandbox, ".claude"));
writeFileSync(settingsPath, JSON.stringify({
  permissions: {
    allow: ["Bash(skill/bin/clickbait-audio *)"]
  }
}, null, 2) + "\n");
console.log("  .claude/settings.json (binary pre-whitelisted)");

console.log("\n=== Done ===");
console.log("\nOpen a new Claude Code session in sandbox/ to test the skill:");
console.log("  cd sandbox && claude");
