#!/usr/bin/env node
/**
 * Render .claude/skills/clickbait/SKILL.md from its Nunjucks template.
 *
 * Reads DSongL types and builder signatures from packages/dsongl/src/ and
 * injects them into the template. Run at release time (or locally with
 * `npm run build:skill`) after the binary is built.
 *
 * Usage: node scripts/render-skill.mjs
 */

import nunjucks from "nunjucks";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// --- Extract types from types.ts ---

// Types excluded from the skill API reference (not used in song authoring)
const EXCLUDED_TYPES = new Set(["Word", "Phrase"]);

function extractTypes(source) {
  const lines = source.split("\n");
  const blocks = [];
  let capture = false;
  let depth = 0;
  let block = [];
  let currentName = "";

  for (const line of lines) {
    if (!capture && /^export (type|interface) /.test(line)) {
      const m = line.match(/^export (?:type|interface) (\w+)/);
      currentName = m ? m[1] : "";
      if (EXCLUDED_TYPES.has(currentName)) continue;
      capture = true;
      depth = 0;
      block = [];
    }
    if (capture) {
      block.push(line);
      depth += (line.match(/\{/g) || []).length;
      depth -= (line.match(/\}/g) || []).length;
      if (depth <= 0 && block.length > 0) {
        blocks.push(block.join("\n"));
        capture = false;
        block = [];
      }
    }
  }

  return blocks.join("\n\n");
}

// --- Extract public function signatures from dsongl.ts ---

function extractBuilders(source) {
  const sigs = [];
  const seen = new Map();

  for (const line of source.split("\n")) {
    if (!/^export function /.test(line)) continue;

    const name = (line.match(/function (\w+)/) || [])[1] || "";
    const count = seen.get(name) || 0;

    // Skip implementation overloads: wider union/rest types, or 3rd+ signature for same name
    if (count >= 1 && /\.\.\.|(\w+\s*\|\s*\w+)/.test(line)) continue;
    if (count >= 2) continue;
    seen.set(name, count + 1);

    // Extract signature up to closing paren + return type, strip body
    const match = line.match(/^(export function .+?\)(?::\s*[\w\[\], ]+)?)/);
    if (match) sigs.push(match[1] + ";");
  }

  return sigs.join("\n");
}

// --- Read sources ---

const typesSource = readFileSync(
  resolve(root, "src/dsongl/types.ts"),
  "utf-8"
);
const dsonglSource = readFileSync(
  resolve(root, "src/dsongl/dsongl.ts"),
  "utf-8"
);

const dsongl_types = extractTypes(typesSource);
const dsongl_builders = extractBuilders(dsonglSource);

// --- Render template ---

const templatePath = resolve(root, "skill/SKILL.md.njk");
const outputPath = resolve(root, ".claude/skills/clickbait/SKILL.md");

nunjucks.configure({ autoescape: false });
const template = readFileSync(templatePath, "utf-8");
const rendered = nunjucks.renderString(template, { dsongl_types, dsongl_builders });

writeFileSync(outputPath, rendered);

const typeLines = dsongl_types.split("\n").length;
const builderLines = dsongl_builders.split("\n").length;
console.log(
  `Rendered SKILL.md: ${typeLines} type lines, ${builderLines} builder lines injected.`
);
