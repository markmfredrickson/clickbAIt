import { describe, it, expect } from "vitest";
import { extractLyricsText } from "../src/authoring/lookup/genius.js";
import { pickTrack } from "../src/authoring/lookup/deezer.js";

/** A Genius lyric page reduced to what the scraper reads: lyric containers,
 *  the first one opening with the excluded header (contributor count, title,
 *  description). */
function page(header: string, ...containers: string[]): string {
  const [first, ...rest] = containers;
  const head = `<div data-exclude-from-selection="true" class="LyricsHeader__Container">${header}</div>`;
  return (
    `<html><body>` +
    `<div data-lyrics-container="true">${head}${first}</div>` +
    rest.map((c) => `<div data-lyrics-container="true">${c}</div>`).join("") +
    `</body></html>`
  );
}

const HEADER = `<div>12 Contributors</div><h2>Test Song Lyrics</h2>`;

describe("extractLyricsText", () => {
  it("drops a header whose description has no Read More", () => {
    const html = page(
      `${HEADER}<div>This was a Number One hit in 1966.</div>`,
      `[Verse 1]<br>lorem ipsum dolor<br>sit amet<br><br>[Chorus]<br>consectetur`,
    );
    const text = extractLyricsText(html);
    expect(text.split("\n")[0]).toBe("[Verse 1]");
    expect(text).not.toContain("Number One");
  });

  it("drops a header whose description ends in Read More", () => {
    const html = page(
      `${HEADER}<div>A long story about the song… Read More</div>`,
      `[Verse 1]<br>lorem ipsum dolor`,
    );
    const text = extractLyricsText(html);
    expect(text.split("\n")[0]).toBe("[Verse 1]");
    expect(text).not.toContain("Read More");
  });

  it("keeps lyric lines that contain the word Lyrics or Read More", () => {
    const html = page(
      HEADER,
      `[Verse 1]<br>I wrote the Lyrics on my hand<br>Read More books, she said`,
    );
    expect(extractLyricsText(html).split("\n")).toEqual([
      "[Verse 1]",
      "I wrote the Lyrics on my hand",
      "Read More books, she said",
    ]);
  });

  it("joins every lyric container", () => {
    const html = page(HEADER, `[Verse 1]<br>lorem`, `[Chorus]<br>ipsum`);
    expect(extractLyricsText(html).split("\n")).toEqual([
      "[Verse 1]",
      "lorem",
      "[Chorus]",
      "ipsum",
    ]);
  });

  it("still strips the old preamble on pages without the header", () => {
    const html =
      `<html><body><div data-lyrics-container="true">` +
      `12 ContributorsTest Song LyricsSome blurb. Read More [Verse 1]<br>lorem` +
      `</div></body></html>`;
    expect(extractLyricsText(html).split("\n")).toEqual(["[Verse 1]", "lorem"]);
  });
});

/** Deezer /search hits, reduced to the fields pickTrack reads. */
function hit(
  id: number,
  artist: string,
  title_short: string,
  title_version = "",
) {
  const title = title_version ? `${title_short} ${title_version}` : title_short;
  return { id, title, title_short, title_version, duration: 200, artist: { name: artist } };
}

describe("pickTrack", () => {
  it("picks the first hit whose title and artist match", () => {
    const hits = [
      hit(1, "Someone Else", "Get Back"),
      hit(2, "The Beatles", "Get Back", "(Remastered 2009)"),
      hit(3, "The Beatles", "Get Back"),
    ];
    expect(pickTrack(hits, "Get Back", "The Beatles")?.id).toBe(2);
  });

  it("matches across case, punctuation, curly apostrophes and a leading The", () => {
    expect(pickTrack([hit(1, "Gorillaz", "Feel Good Inc.")], "feel good inc", "gorillaz")?.id).toBe(1);
    expect(pickTrack([hit(1, "Paramore", "Ain't It Fun")], "Ain’t It Fun", "Paramore")?.id).toBe(1);
    expect(pickTrack([hit(1, "alt-J", "Left Hand Free")], "Left Hand Free", "alt‐J")?.id).toBe(1);
    expect(pickTrack([hit(1, "Pretenders", "Back on the Chain Gang")], "Back on the Chain Gang", "The Pretenders")?.id).toBe(1);
  });

  it("skips versions that aren't the studio recording", () => {
    const hits = [
      hit(1, "Pretenders", "Back on the Chain Gang", "(Live)"),
      hit(2, "Pretenders", "Back on the Chain Gang", "(Acoustic Version)"),
      hit(3, "Pretenders", "Back on the Chain Gang", "(2006 Remaster)"),
    ];
    expect(pickTrack(hits, "Back on the Chain Gang", "Pretenders")?.id).toBe(3);
  });

  it("accepts remaster, mono and single-version tags", () => {
    for (const v of ["(Remastered 2009)", "(2006 Remaster)", "(Remastered)", "(Mono)", "(Single Version)", "- Radio Edit"]) {
      expect(pickTrack([hit(1, "The Beatles", "Get Back", v)], "Get Back", "The Beatles")?.id).toBe(1);
    }
  });

  it("returns null when only other versions match rather than guess", () => {
    const hits = [
      hit(1, "Nirvana", "In Bloom", "(1992/Live at Reading)"),
      hit(2, "Nirvana", "In Bloom", "(Smart Sessions)"),
      hit(3, "Nirvana", "In Bloom", "(Devonshire Mix)"),
    ];
    expect(pickTrack(hits, "In Bloom", "Nirvana")).toBeNull();
  });

  it("returns null when no title matches", () => {
    expect(pickTrack([hit(1, "The Monkees", "Daydream Believer")], "I'm a Believer", "The Monkees")).toBeNull();
  });

  it("matches on title alone when no artist is given", () => {
    expect(pickTrack([hit(1, "Anyone", "Get Back")], "Get Back")?.id).toBe(1);
  });
});
