#!/usr/bin/env node
/**
 * Populate sandbox/ with built artifacts, simulating a fresh beta user install.
 *
 * Copies (not symlinks) so the sandbox is a true snapshot of what a user gets.
 * Re-run after any build to refresh.
 *
 * Usage: node scripts/setup-sandbox.mjs
 */

import { copyFileSync, mkdirSync, existsSync, cpSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

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

// Skill docs and generated SKILL.md (into .claude/skills/clickbait/)
copyDir("skill", ".claude/skills/clickbait");
copy(".claude/skills/clickbait/SKILL.md", ".claude/skills/clickbait/SKILL.md");

// Binary (prefer release, fall back to debug) → .claude/skills/clickbait/bin/
const releaseBin = "skill/bin/clickbait-audio";
const releaseFallback = "target/release/clickbait-audio";
const debugFallback = "target/debug/clickbait-audio";

if (existsSync(resolve(root, releaseBin))) {
  copy(releaseBin, ".claude/skills/clickbait/bin/clickbait-audio");
} else if (existsSync(resolve(root, releaseFallback))) {
  console.log("  (skill/bin not populated — using target/release)");
  copy(releaseFallback, ".claude/skills/clickbait/bin/clickbait-audio");
} else if (existsSync(resolve(root, debugFallback))) {
  console.log("  (skill/bin not populated — using target/debug)");
  copy(debugFallback, ".claude/skills/clickbait/bin/clickbait-audio");
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

// Pack and install the npm package locally in the sandbox
console.log("  Packing clickbait npm package...");
const packOutput = execSync("npm pack --json", { cwd: root }).toString();
const [{ filename }] = JSON.parse(packOutput);
const tgz = resolve(root, filename);
execSync(`npm install --prefix "${sandbox}" "${tgz}"`, { stdio: "pipe" });
// Clean up tgz — it's installed now
execSync(`rm "${tgz}"`);
console.log(`  clickbait installed → sandbox/node_modules/`);

// Empty songs dir
dir(resolve(sandbox, "songs"));
console.log("  songs/ (empty)");

// Pre-whitelist the binary so the sandbox doesn't prompt
const settingsPath = resolve(sandbox, ".claude/settings.json");
dir(resolve(sandbox, ".claude"));
const logPath = resolve(sandbox, "session.log").replace(/'/g, "'\\''");
writeFileSync(settingsPath, JSON.stringify({
  permissions: {
    allow: [
      "Bash(.claude/skills/clickbait/bin/clickbait-audio *)",
      "Bash(node_modules/.bin/clickbait-generate *)",
      "Bash(node_modules/.bin/clickbait-teleprompter *)",
      "Bash(mkdir *)"
    ]
  },
  hooks: {
    PostToolUse: [{
      matcher: "Bash",
      hooks: [{ type: "command", async: true,
        command: `jq -r '"[" + (now | strftime("%H:%M:%S")) + "] " + (.tool_input.command | split("\\n")[0])' >> '${logPath}' 2>/dev/null || true`
      }]
    }],
    PostToolUseFailure: [{
      matcher: "Bash",
      hooks: [{ type: "command", async: true,
        command: `jq -r '"[" + (now | strftime("%H:%M:%S")) + "] [FAIL] " + (.tool_input.command | split("\\n")[0])' >> '${logPath}' 2>/dev/null || true`
      }]
    }],
  }
}, null, 2) + "\n");
console.log("  .claude/settings.json (commands pre-whitelisted, session logging enabled)");

console.log("\n=== Done ===");
console.log("\nOpen a new Claude Code session in sandbox/ to test the skill:");
console.log("  cd sandbox && claude");
