/**
 * Practice-bundle audio variants — which mixes get rendered for a song.
 *
 * A band member practices against a mix-minus of their own part, so the bundle
 * carries one rendered Opus per variant instead of a client-side mixer:
 *
 *   full          every stem + click + cues      → <slug>.opus
 *   minus-<stem>  that stem muted                → <slug>.minus-<stem>.opus
 *   click-only    every stem muted               → <slug>.click-only.opus
 *
 * The default list follows the manifest's stem keys (4-stem demucs → 6 files,
 * 6-stem → 8). A manifest `bundle.variants` block REPLACES the defaults, so a
 * song can add a "minus-rhythm" or drop a variant nobody wants.
 *
 * Files are named slug-first so they still read on someone's phone or in a
 * playlist, away from the bundle's player.
 */

import type { SongManifest } from "../manifest.js";

export interface BundleVariant {
  /** Kebab-case id; also the file-name suffix (except `full`, which is bare). */
  id: string;
  /** Dropdown text. */
  label: string;
  /** Rendered file name inside the bundle / song folder. */
  file: string;
  /** Stem keys (of `sources.stems.files`) muted in this render. */
  mute: string[];
}

/** RPP track name manifest-to-song gives a stem key (title-cased key). */
export function stemTrackName(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** Kebab-case a stem key ("lead vocal" → "lead-vocal") for ids and file names.
 *  REAPER's RENDER_PATTERN stops at a space, so ids must never carry one. */
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function variantFile(slug: string, id: string): string {
  return id === "full" ? `${slug}.opus` : `${slug}.${id}.opus`;
}

function labelFromId(id: string): string {
  const words = id.split("-");
  return stemTrackName(words[0]) + (words.length > 1 ? " " + words.slice(1).join(" ") : "");
}

export function bundleVariants(manifest: SongManifest, slug: string): BundleVariant[] {
  const stemKeys = Object.keys(manifest.sources.stems?.files ?? {});
  const known = new Set(stemKeys);

  const override = manifest.bundle?.variants;
  if (override) {
    const seen = new Set<string>();
    return override.map((v) => {
      if (seen.has(v.id)) throw new Error(`bundle.variants: duplicate id "${v.id}"`);
      seen.add(v.id);
      for (const k of v.mute) {
        if (!known.has(k)) {
          throw new Error(`bundle.variants "${v.id}" mutes "${k}", which is not a stem (have: ${stemKeys.join(", ") || "none"})`);
        }
      }
      return { id: v.id, label: v.label ?? labelFromId(v.id), file: variantFile(slug, v.id), mute: [...v.mute] };
    });
  }

  const full: BundleVariant = { id: "full", label: "Full mix", file: variantFile(slug, "full"), mute: [] };
  if (stemKeys.length === 0) return [full];
  return [
    full,
    ...stemKeys.map((k) => ({
      id: `minus-${slugify(k)}`,
      label: `Minus ${k}`,
      file: variantFile(slug, `minus-${slugify(k)}`),
      mute: [k],
    })),
    { id: "click-only", label: "Click only", file: variantFile(slug, "click-only"), mute: [...stemKeys] },
  ];
}
