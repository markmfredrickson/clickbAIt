import { describe, it, expect } from "vitest";
import { bundleVariants, stemTrackName } from "../src/build/bundle-variants.js";
import type { SongManifest } from "../src/manifest.js";

// Only the parts of the manifest the variant list reads: the stem keys and the
// optional `bundle` block. Cast keeps the fixture small.
function manifest(files: Record<string, string> | undefined, bundle?: unknown): SongManifest {
  return {
    sources: {
      recording: { kind: "audio", file: "source.m4a" },
      ...(files ? { stems: { kind: "audio-group", curveRef: "recording", dir: "stems/", files } } : {}),
    },
    ...(bundle ? { bundle } : {}),
  } as unknown as SongManifest;
}

const fourStems = { vocals: "v.wav", drums: "d.wav", bass: "b.wav", other: "o.wav" };
const slug = "seven-nation-army-the-white-stripes";

describe("bundleVariants — defaults", () => {
  it("yields full, minus-<each stem> in manifest order, then click-only", () => {
    const v = bundleVariants(manifest(fourStems), slug);
    expect(v.map((x) => x.id)).toEqual([
      "full", "minus-vocals", "minus-drums", "minus-bass", "minus-other", "click-only",
    ]);
  });

  it("names every file by the song slug; the full mix keeps the bare <slug>.opus", () => {
    const v = bundleVariants(manifest(fourStems), slug);
    expect(v.find((x) => x.id === "full")!.file).toBe(`${slug}.opus`);
    expect(v.find((x) => x.id === "minus-drums")!.file).toBe(`${slug}.minus-drums.opus`);
    expect(v.find((x) => x.id === "click-only")!.file).toBe(`${slug}.click-only.opus`);
  });

  it("mutes nothing for full, one stem for minus-X, and every stem for click-only", () => {
    const v = bundleVariants(manifest(fourStems), slug);
    expect(v.find((x) => x.id === "full")!.mute).toEqual([]);
    expect(v.find((x) => x.id === "minus-bass")!.mute).toEqual(["bass"]);
    expect(v.find((x) => x.id === "click-only")!.mute).toEqual(["vocals", "drums", "bass", "other"]);
  });

  it("gives human labels", () => {
    const v = bundleVariants(manifest(fourStems), slug);
    expect(v.map((x) => x.label)).toEqual([
      "Full mix", "Minus vocals", "Minus drums", "Minus bass", "Minus other", "Click only",
    ]);
  });

  it("scales with the stem count (6-stem demucs → 8 variants)", () => {
    const six = { ...fourStems, guitar: "g.wav", piano: "p.wav" };
    expect(bundleVariants(manifest(six), slug)).toHaveLength(8);
  });

  it("slugifies multitrack stem keys with spaces into ids and file names", () => {
    const kv = { "lead vocal": "kv/lead-vocal.mp3", "rhythm guitar l": "kv/rg-l.mp3" };
    const v = bundleVariants(manifest(kv), slug);
    expect(v.map((x) => x.id)).toEqual(["full", "minus-lead-vocal", "minus-rhythm-guitar-l", "click-only"]);
    expect(v[1].file).toBe(`${slug}.minus-lead-vocal.opus`);
    expect(v[1].label).toBe("Minus lead vocal");
    expect(v[1].mute).toEqual(["lead vocal"]); // mute keeps the real stem key
  });

  it("is just the full mix when the song has no stems", () => {
    const v = bundleVariants(manifest(undefined), slug);
    expect(v.map((x) => x.id)).toEqual(["full"]);
  });
});

describe("bundleVariants — manifest `bundle.variants` override", () => {
  it("replaces the default list entirely", () => {
    const v = bundleVariants(
      manifest(fourStems, { variants: [{ id: "minus-rhythm", label: "No drums or bass", mute: ["drums", "bass"] }] }),
      slug,
    );
    expect(v).toEqual([
      { id: "minus-rhythm", label: "No drums or bass", file: `${slug}.minus-rhythm.opus`, mute: ["drums", "bass"] },
    ]);
  });

  it("derives a label from the id when none is given", () => {
    const v = bundleVariants(manifest(fourStems, { variants: [{ id: "minus-drums", mute: ["drums"] }] }), slug);
    expect(v[0].label).toBe("Minus drums");
  });

  it("keeps the bare <slug>.opus file name for an override named `full`", () => {
    const v = bundleVariants(manifest(fourStems, { variants: [{ id: "full", mute: [] }] }), slug);
    expect(v[0].file).toBe(`${slug}.opus`);
  });

  it("rejects a mute key that names no stem", () => {
    expect(() =>
      bundleVariants(manifest(fourStems, { variants: [{ id: "x", mute: ["keys"] }] }), slug),
    ).toThrow(/keys/);
  });

  it("rejects duplicate ids", () => {
    expect(() =>
      bundleVariants(
        manifest(fourStems, { variants: [{ id: "a", mute: [] }, { id: "a", mute: ["drums"] }] }),
        slug,
      ),
    ).toThrow(/duplicate/i);
  });
});

describe("stemTrackName", () => {
  it("matches the RPP track name manifest-to-song gives a stem key", () => {
    expect(stemTrackName("drums")).toBe("Drums");
    expect(stemTrackName("lead vocal")).toBe("Lead vocal");
  });
});
