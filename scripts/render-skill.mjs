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
  const seen = new Set();

  for (const line of source.split("\n")) {
    if (!/^export function /.test(line)) continue;

    const name = (line.match(/function (\w+)/) || [])[1] || "";

    // Skip implementation overloads (wider union/rest types) once name seen
    if (seen.has(name) && /\.\.\.|(\w+\s*\|\s*\w+)/.test(line)) continue;
    seen.add(name);

    // Extract signature up to closing paren + return type, strip body
    const match = line.match(/^(export function .+?\)(?::\s*[\w\[\], ]+)?)/);
    if (match) sigs.push(match[1] + ";");
  }

  return sigs.join("\n");
}

// --- Read sources ---

const typesSource = readFileSync(
  resolve(root, "packages/dsongl/src/types.ts"),
  "utf-8"
);
const dsonglSource = readFileSync(
  resolve(root, "packages/dsongl/src/dsongl.ts"),
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
