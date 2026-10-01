import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { notationCss, renderRanges } from "../../src/charts/notation-svg.js";

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
  it("embeds the music font, so a bundle opened from disk can show it", () => {
    const css = notationCss(new Uint8Array([1, 2, 3]));
    expect(css).toContain("url(data:font/woff2;base64,AQID)");
    expect(css).toMatch(/\.notation \.at \{[^}]*font-family/);
  });
});
