import { describe, it, expect } from "vitest";
import { linearize } from "../src/linearize.js";
import type { Song } from "@clickbait/dsongl";

// Import eval outputs — these use relative paths to dsongl, so we import the default exports
import takeFiveIter1 from "../clickbait-workspace/iteration-1/take-five-brubeck/with_skill/outputs/take-five.js";
import takeFiveIter2 from "../clickbait-workspace/iteration-2/take-five-brubeck/with_skill/outputs/take-five.js";
import bohRhapIter1 from "../clickbait-workspace/iteration-1/bohemian-rhapsody-queen/with_skill/outputs/bohemian-rhapsody.js";
import bohRhapIter2 from "../clickbait-workspace/iteration-2/bohemian-rhapsody-queen/with_skill/outputs/bohemian-rhapsody.js";
import valerieIter1 from "../clickbait-workspace/iteration-1/valerie-amy-winehouse/with_skill/outputs/valerie.js";
import valerieIter2 from "../clickbait-workspace/iteration-2/valerie-amy-winehouse/with_skill/outputs/valerie.js";

const evals: [string, Song][] = [
  ["Take Five (iter 1)", takeFiveIter1 as Song],
  ["Take Five (iter 2)", takeFiveIter2 as Song],
  ["Bohemian Rhapsody (iter 1)", bohRhapIter1 as Song],
  ["Bohemian Rhapsody (iter 2)", bohRhapIter2 as Song],
  ["Valerie (iter 1)", valerieIter1 as Song],
  ["Valerie (iter 2)", valerieIter2 as Song],
];

describe("linearize eval outputs", () => {
  for (const [name, song] of evals) {
    it(`${name} linearizes without error`, () => {
      const events = linearize(song);
      expect(events.length).toBeGreaterThan(0);
    });

    it(`${name} has no negative beat positions`, () => {
      const events = linearize(song);
      for (const e of events) {
        expect(e.beat).toBeGreaterThanOrEqual(0);
      }
    });

    it(`${name} seconds are monotonically non-decreasing`, () => {
      const events = linearize(song);
      for (let i = 1; i < events.length; i++) {
        expect(events[i].seconds).toBeGreaterThanOrEqual(events[i - 1].seconds);
      }
    });
  }
});
