import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { notationBars, notationCss, renderBars } from "../../src/charts/notation-svg.js";
import type { RowDocument } from "../../src/teleprompter/rows.js";

const SCORE = new Uint8Array(readFileSync(join(import.meta.dirname, "../fixtures/charts/three-tracks.atex")));
const DRUMS = 2;

describe("renderBars", () => {
  it("draws each bar asked for as its own SVG", async () => {
    const svgs = await renderBars(SCORE, DRUMS, [1, 2]);
    expect(Object.keys(svgs)).toEqual(["1", "2"]);
    for (const svg of Object.values(svgs)) expect(svg).toMatch(/^<svg [^>]*width="[\d.]+px" height="[\d.]+px"/);
  });

  it("inks in the page's text color, so it reads in either theme", async () => {
    const { 1: svg } = await renderBars(SCORE, DRUMS, [1]);
    expect(svg).toContain('fill="currentColor"');
    expect(svg).not.toMatch(/fill="#/);
  });

  it("leaves out alphaTab's credit, which the prompter gives once in its drawer", async () => {
    const { 1: svg } = await renderBars(SCORE, DRUMS, [1]);
    expect(svg).not.toMatch(/rendered by alphaTab/i);
  });
});

describe("notationBars", () => {
  it("lists the score bars each drum channel draws, once each", () => {
    const run = (letter: string, scoreBar: number, first: boolean) => ({ letter, count: 1, barBeats: 4, songBar: 1, scoreBar, first, start: 0, end: 4 });
    const doc = {
      channels: [
        { id: "lyrics", kind: "lyrics", rows: [] },
        { id: "kit", kind: "drums", instrument: "drums", source: "s.gp5", track: 4, rows: [
          { section: 0, start: 0, end: 8, items: [run("A", 3, true), run("B", 7, true)] },
          { section: 1, start: 8, end: 16, items: [run("A", 3, true), run("B", 7, false)] },
        ] },
      ],
    } as unknown as RowDocument;
    expect(notationBars(doc)).toEqual([{ id: "kit", source: "s.gp5", track: 4, bars: [3, 7] }]);
  });
});

describe("notationCss", () => {
  it("embeds the music font, so a bundle opened from disk can show it", () => {
    const css = notationCss(new Uint8Array([1, 2, 3]));
    expect(css).toContain("url(data:font/woff2;base64,AQID)");
    expect(css).toMatch(/\.drum-notation \.at \{[^}]*font-family/);
  });
});
