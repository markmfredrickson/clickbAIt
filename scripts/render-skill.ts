#!/usr/bin/env npx tsx
/**
 * Render the clickbait skill from its Nunjucks templates.
 *
 *   skill/SKILL.md.njk    → .claude/skills/clickbait/SKILL.md   (lean router, always loaded)
 *   skill/manifest.md.njk → skill/manifest.md                   (authoring reference, on-demand)
 *
 * The manifest reference carries the song-manifest JSON Schema, generated from
 * the zod schema (`src/manifest.ts`) via zod v4's native `z.toJSONSchema`, so
 * the skill's reference can't drift from the code. Keeping it in the on-demand
 * `manifest.md` (not SKILL.md) keeps the always-loaded skill small. Run with
 * `npm run build:skill`.
 */

import nunjucks from "nunjucks";
import { z } from "zod";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SongManifestSchema } from "../src/manifest.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

nunjucks.configure({ autoescape: false });

function render(templateRel: string, outRel: string, context: Record<string, unknown>) {
  const template = readFileSync(resolve(root, templateRel), "utf-8");
  writeFileSync(resolve(root, outRel), nunjucks.renderString(template, context));
}

// zod v4 native JSON-schema generation. `unrepresentable: "any"` lets the
// cross-field superRefine (curveRef check) pass through instead of throwing.
const jsonSchema = z.toJSONSchema(SongManifestSchema, { unrepresentable: "any" });
const manifest_schema = JSON.stringify(jsonSchema, null, 2);

render("skill/SKILL.md.njk", ".claude/skills/clickbait/SKILL.md", {});
render("skill/manifest.md.njk", "skill/manifest.md", { manifest_schema });

console.log(
  `Rendered SKILL.md + manifest.md (schema: ${manifest_schema.split("\n").length} lines, on-demand).`,
);
