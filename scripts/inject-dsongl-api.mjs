#!/usr/bin/env node
/**
 * Extract the DS(ong)L public API surface from types.ts and dsongl.ts,
 * then inject a compact reference into SKILL.md between markers.
 *
 * Usage: node scripts/inject-dsongl-api.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const MARKER_START = "<!-- DSONGL-API-START -->";
const MARKER_END = "<!-- DSONGL-API-END -->";

/** Strip implementation bodies from exported functions, keeping just signatures. */
function extractSignatures(source) {
  const sigs = [];
  for (const line of source.split("\n")) {
    if (/^export function /.test(line)) {
      if (line.trimEnd().endsWith(";")) {
        sigs.push(line.trimEnd());
      } else {
        const match = line.match(/^(export function .+?\)(?::\s*\S+)?)/);
        if (match) sigs.push(match[1] + ";");
      }
    }
  }
  return sigs;
}

/** Extract type/interface/export type blocks from source. */
function extractTypes(source) {
  const lines = source.split("\n");
  const blocks = [];
  let capture = false;
  let depth = 0;
  let block = [];

  for (const line of lines) {
    if (!capture && /^export (type|interface) /.test(line)) {
      capture = true;
      depth = 0;
      block = [];
    }

    if (capture) {
      block.push(line);
      depth += (line.match(/{/g) || []).length;
      depth -= (line.match(/}/g) || []).length;

      if (depth <= 0 && block.length > 0) {
        blocks.push(block.join("\n"));
        capture = false;
        block = [];
      }
    }
  }

  return blocks.join("\n\n");
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --- Main ---

const typesSource = readFileSync(resolve(root, "src/types.ts"), "utf-8");
const dsonglSource = readFileSync(resolve(root, "src/dsongl.ts"), "utf-8");
const skillPath = resolve(root, ".claude/skills/clickbait/SKILL.md");
const skillSource = readFileSync(skillPath, "utf-8");

const types = extractTypes(typesSource);
const sigs = extractSignatures(dsonglSource);

// Keep user-facing overloads, drop implementation sigs (wider union/rest types)
const deduped = [];
const seen = new Set();
for (const sig of sigs) {
  const name = (sig.match(/function (\w+)/) || [])[1] || "";
  if (seen.has(name) && /\.\.\.|(\w+\s*\|\s*\w+)/.test(sig)) continue;
  seen.add(name);
  deduped.push(sig);
}

const apiBlock = `${MARKER_START}
### Types

\`\`\`typescript
${types}
\`\`\`

### Builder functions (from \`dsongl.ts\`)

\`\`\`typescript
${deduped.join("\n")}
\`\`\`
${MARKER_END}`;

const markerRe = new RegExp(
  `${escapeRegExp(MARKER_START)}[\\s\\S]*?${escapeRegExp(MARKER_END)}`
);

if (!markerRe.test(skillSource)) {
  console.error("ERROR: Markers not found in SKILL.md. Add these lines where you want the API reference:");
  console.error(`  ${MARKER_START}`);
  console.error(`  ${MARKER_END}`);
  process.exit(1);
}

const updated = skillSource.replace(markerRe, apiBlock);
writeFileSync(skillPath, updated);

const lineCount = apiBlock.split("\n").length;
console.log(`Injected ${lineCount} lines of DS(ong)L API reference into SKILL.md`);
