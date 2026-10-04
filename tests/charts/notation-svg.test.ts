import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { drawNotation, fontDataUri, notationCss, renderRanges } from "../../src/charts/notation-svg.js";
import type { RowDocument } from "../../src/teleprompter/rows.js";

const SCORE = new Uint8Array(readFileSync(join(import.meta.dirname, "../fixtures/charts/three-tracks.atex")));
const GUITAR = 0;
const DRUMS = 2;

describe("renderRanges", () => {
  it("draws each range asked for, named by where it starts and how many bars", async () => {
    const drawn = await renderRanges(SCORE, DRUMS, "drums", [{ start: 1, count: 1 }, { start: 2, count: 1 }]);
    expect(Object.keys(drawn)).toEqual(["1+1", "2+1"]);
    for (const d of Object.values(drawn)) expect(d.svg).toMatch(/^<svg [^>]*width="[\d.]+px" height="[\d.]+px"/);
  });

  it("says where each bar of a range lands, left to right inside the drawing", async () => {
    const { "1+2": d } = await renderRanges(SCORE, GUITAR, "tab", [{ start: 1, count: 2 }]);
    expect(d.bars).toHaveLength(2);
    expect(d.bars[0].x).toBeLessThan(d.bars[1].x);
    expect(d.bars[1].x + d.bars[1].w).toBeLessThanOrEqual(d.width + 1);
  });

  it("draws tab with notation above it taller than tab alone", async () => {
    const tab = (await renderRanges(SCORE, GUITAR, "tab", [{ start: 1, count: 1 }]))["1+1"];
    const both = (await renderRanges(SCORE, GUITAR, "staff-tab", [{ start: 1, count: 1 }]))["1+1"];
    expect(both.height).toBeGreaterThan(tab.height);
  });

  it("draws a bar that a note is tied into, as a plain note (alphaTab can't draw half a tie)", async () => {
    const tied = new TextEncoder().encode('\\track "G"\n\\staff {score tabs}\n3.3.4 3.3.4 3.3.4 3.3.4 | -.3.4 5.3.4 5.3.4 5.3.4 |');
    expect(Object.keys(await renderRanges(tied, 0, "tab", [{ start: 2, count: 1 }]))).toEqual(["2+1"]);
  });

  it("draws a bar that a legato slide comes into", async () => {
    const slide = new TextEncoder().encode('\\track "G"\n\\staff {tabs}\n3.3.4 3.3.4 3.3.4 3.3{sl}.4 | 5.3.4 5.3.4 5.3.4 5.3.4 |');
    expect(Object.keys(await renderRanges(slide, 0, "tab", [{ start: 2, count: 1 }]))).toEqual(["2+1"]);
  });

  it("draws bars that a chain of hammer-ons runs into from before them", async () => {
    const chain = new TextEncoder().encode(
      '\\track "G"\n\\staff {tabs}\n3.3.4 3.3.4 3.3{h}.4 5.3{h}.4 | 7.3{h}.4 5.3.4 5.3.4 5.3.4 | 3.3.4 3.3.4 3.3.4 3.3.4 |',
    );
    expect(Object.keys(await renderRanges(chain, 0, "tab", [{ start: 2, count: 2 }]))).toEqual(["2+2"]);
  });

  it("draws no key signature on a drum chart, but keeps it on a pitched staff", async () => {
    const SHARP = "&#57954;"; // Bravura's sharp, U+E262
    const inG = new TextEncoder().encode(
      '\\track "G"\n\\staff {score}\n\\ks G C4.4 C4.4 C4.4 C4.4 |\n' +
        '\\track "Drums"\n\\instrument percussion\n\\articulation defaults\n\\staff {score}\n\\ks G KickHit.4 SnareHit.4 KickHit.4 SnareHit.4 |',
    );
    const pitched = (await renderRanges(inG, 0, "staff", [{ start: 1, count: 1 }]))["1+1"];
    const drums = (await renderRanges(inG, 1, "drums", [{ start: 1, count: 1 }]))["1+1"];
    expect(pitched.svg).toContain(SHARP);
    expect(drums.svg).not.toContain(SHARP);
  });

  it("inks in the page's text color, so it reads in either theme", async () => {
    const { "1+1": d } = await renderRanges(SCORE, DRUMS, "drums", [{ start: 1, count: 1 }]);
    expect(d.svg).toContain('fill="currentColor"');
    expect(d.svg).not.toMatch(/fill="#/);
  });

  it("leaves out alphaTab's credit, which the prompter gives once in its drawer", async () => {
    const { "1+1": d } = await renderRanges(SCORE, DRUMS, "drums", [{ start: 1, count: 1 }]);
    expect(d.svg).not.toMatch(/rendered by alphaTab/i);
  });
});

describe("notationCss", () => {
  it("loads the music font from where it's given: the relay's copy, or a bundle's own", () => {
    expect(notationCss("/vendor/alphatab/font/Bravura.woff2")).toContain("url(/vendor/alphatab/font/Bravura.woff2)");
    const css = notationCss(fontDataUri(new Uint8Array([1, 2, 3])));
    expect(css).toContain("url(data:font/woff2;base64,AQID)");
    expect(css).toMatch(/\.notation \.at \{[^}]*font-family/);
  });
});

describe("drawNotation", () => {
  it("draws every range each chart channel needs, by channel and range", async () => {
    const doc = {
      channels: [
        { id: "lyrics", kind: "lyrics", rows: [] },
        { id: "kit", kind: "figures", chart: "drums", instrument: "drums", source: "song.atex", track: DRUMS, rows: [
          { type: "figures", section: 0, start: 0, end: 4, items: [{ letters: ["A"], scoreBars: [1], barBeats: [4], draw: [true], count: 1, phraseBeats: 4, songBar: 1, start: 0, end: 4 }] },
        ] },
        { id: "guitar", kind: "score", chart: "tab", instrument: "guitar", source: "song.atex", track: GUITAR, rows: [
          { type: "score", section: 0, start: 0, end: 8, items: [{ songBar: 1, scoreBar: 1, start: 0, end: 4 }, { songBar: 2, scoreBar: 2, start: 4, end: 8 }] },
        ] },
      ],
    } as unknown as RowDocument;
    const drawn = await drawNotation(doc, (path) => (path === "song.atex" ? SCORE : null));
    expect(Object.keys(drawn)).toEqual(["kit", "guitar"]);
    expect(Object.keys(drawn.kit)).toEqual(["1+1"]);
    expect(drawn.guitar["1+2"].bars).toHaveLength(2);
  });

  it("leaves out a chart whose score file is missing", async () => {
    const doc = { channels: [{ id: "kit", kind: "figures", chart: "drums", instrument: "drums", source: "gone.gp5", track: 0, rows: [] }] } as unknown as RowDocument;
    expect(await drawNotation(doc, () => null)).toEqual({});
  });
});
