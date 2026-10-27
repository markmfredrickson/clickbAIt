import { describe, it, expect, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readGig } from "../src/gig/gig.js";
import { gigRecipe } from "../src/gig/gig-recipe.js";
import { stamp } from "../src/gig/stamp.js";

type Task = { command: string; files?: string[]; output?: string[]; dependencies?: string[] };
type Recipe = { scripts: Record<string, string>; wireit: Record<string, Task> };

/** A repo root with two song folders and an empty gig folder under songs/gigs/. */
function layout() {
  const root = mkdtempSync(join(tmpdir(), "gig-"));
  for (const song of ["songs/band/supremes/you-cant-hurry-love", "songs/band/the-white-stripes/seven-nation-army"]) {
    mkdirSync(join(root, song), { recursive: true });
    writeFileSync(join(root, song, `${song.split("/").pop()}.song.json`), "{}");
  }
  const gig = join(root, "songs/gigs/2026-08-08");
  mkdirSync(gig, { recursive: true });
  return { root, gig };
}

function writeGig(gig: string, body: unknown) {
  writeFileSync(join(gig, "gig.json"), JSON.stringify(body));
}

const SNA = "songs/band/the-white-stripes/seven-nation-army";
const YCHL = "songs/band/supremes/you-cant-hurry-love";

describe("readGig", () => {
  let root: string, gig: string;
  beforeEach(() => ({ root, gig } = layout()));

  it("reads each song's folder, media and audio source, in order", () => {
    writeGig(gig, {
      board: "media/board.m4a",
      songs: [
        { song: SNA, phone: "media/01.mov", audio: "phone" },
        { song: YCHL, phone: "media/02.mov" },
      ],
    });
    const g = readGig(gig, root);
    expect(g.board).toBe("media/board.m4a");
    expect(g.songs).toEqual([
      { n: "01", slug: "seven-nation-army", dir: join(root, SNA), manifest: join(root, SNA, "seven-nation-army.song.json"), phone: "media/01.mov", audio: "phone", mix: 0, cut: {} },
      { n: "02", slug: "you-cant-hurry-love", dir: join(root, YCHL), manifest: join(root, YCHL, "you-cant-hurry-love.song.json"), phone: "media/02.mov", audio: "board", mix: 0.6, cut: {} },
    ]);
  });

  it("keeps media paths relative to the gig folder, tidied", () => {
    writeGig(gig, { board: "./media/../media/board.m4a", songs: [{ song: YCHL, phone: "./media/02.mov" }] });
    const g = readGig(gig, root);
    expect(g.board).toBe("media/board.m4a");
    expect(g.songs[0].phone).toBe("media/02.mov");
  });

  it("needs a board recording when a song takes its audio from the board", () => {
    writeGig(gig, { songs: [{ song: YCHL, phone: "media/02.mov" }] });
    expect(() => readGig(gig, root)).toThrow(/you-cant-hurry-love.*board/);
  });

  it("needs no board recording when every song uses the phone's audio", () => {
    writeGig(gig, { songs: [{ song: SNA, phone: "media/01.mov", audio: "phone" }] });
    expect(readGig(gig, root).board).toBeUndefined();
  });

  it("needs a phone video for every song", () => {
    writeGig(gig, { board: "media/board.m4a", songs: [{ song: YCHL }] });
    expect(() => readGig(gig, root)).toThrow(/phone/);
  });

  it("rejects an audio source it doesn't know", () => {
    writeGig(gig, { board: "media/board.m4a", songs: [{ song: YCHL, phone: "media/02.mov", audio: "camera" }] });
    expect(() => readGig(gig, root)).toThrow(/audio/);
  });

  it("rejects a song folder without a manifest", () => {
    rmSync(join(root, YCHL, "you-cant-hurry-love.song.json"));
    writeGig(gig, { board: "media/board.m4a", songs: [{ song: YCHL, phone: "media/02.mov" }] });
    expect(() => readGig(gig, root)).toThrow(/manifest/);
  });

  it("mixes 60% board, 40% phone unless the gig or the song says otherwise", () => {
    writeGig(gig, {
      board: "media/board.m4a",
      mix: 0.7,
      songs: [{ song: YCHL, phone: "media/02.mov" }, { song: YCHL, phone: "media/03.mov", mix: 0.5 }],
    });
    expect(readGig(gig, root).songs.map((s) => s.mix)).toEqual([0.7, 0.5]);
    writeGig(gig, { board: "media/board.m4a", songs: [{ song: YCHL, phone: "media/02.mov" }] });
    expect(readGig(gig, root).songs[0].mix).toBe(0.6);
  });

  it("mixes no board into a song the board missed, and says so if asked to", () => {
    writeGig(gig, { board: "media/board.m4a", mix: 0.7, songs: [{ song: SNA, phone: "media/01.mov", audio: "phone" }] });
    expect(readGig(gig, root).songs[0].mix).toBe(0);
    writeGig(gig, { board: "media/board.m4a", songs: [{ song: SNA, phone: "media/01.mov", audio: "phone", mix: 0.5 }] });
    expect(() => readGig(gig, root)).toThrow(/mix/);
  });

  it("rejects a mix outside 0 to 1", () => {
    writeGig(gig, { board: "media/board.m4a", songs: [{ song: YCHL, phone: "media/02.mov", mix: 1.5 }] });
    expect(() => readGig(gig, root)).toThrow(/mix/);
  });

  it("rejects a song folder that doesn't exist", () => {
    writeGig(gig, { board: "media/board.m4a", songs: [{ song: "songs/band/nobody/nothing", phone: "media/02.mov" }] });
    expect(() => readGig(gig, root)).toThrow(/songs\/band\/nobody\/nothing/);
  });

  it("reads where each video is cut, in seconds, from either end or both", () => {
    writeGig(gig, {
      board: "media/board.m4a",
      songs: [
        { song: YCHL, phone: "media/02.mov", in: 12.5, out: 190 },
        { song: YCHL, phone: "media/03.mov", in: 4 },
        { song: YCHL, phone: "media/04.mov" },
      ],
    });
    expect(readGig(gig, root).songs.map((s) => s.cut)).toEqual([{ in: 12.5, out: 190 }, { in: 4 }, {}]);
  });

  it("rejects a cut that ends before it starts, or a negative time", () => {
    writeGig(gig, { board: "media/board.m4a", songs: [{ song: YCHL, phone: "media/02.mov", in: 30, out: 30 }] });
    expect(() => readGig(gig, root)).toThrow(/out/);
    writeGig(gig, { board: "media/board.m4a", songs: [{ song: YCHL, phone: "media/02.mov", in: -1 }] });
    expect(() => readGig(gig, root)).toThrow(/in/);
  });
});

describe("gigRecipe", () => {
  let root: string, gig: string;
  beforeEach(() => ({ root, gig } = layout()));

  function recipe(cut: { in?: number; out?: number } = {}): Recipe {
    writeGig(gig, {
      board: "media/board.m4a",
      songs: [
        { song: SNA, phone: "media/01.mov", audio: "phone" },
        { song: YCHL, phone: "media/02.mov", ...cut },
      ],
    });
    return gigRecipe(readGig(gig, root), "../../..") as Recipe;
  }

  const GIG = "npx tsx ../../../src/gig";
  const MANIFEST = "../../band/supremes/you-cant-hurry-love/you-cant-hurry-love.song.json";

  it("syncs each board-audio song's phone video against the board", () => {
    const { scripts, wireit } = recipe();
    expect(scripts["sync:02-you-cant-hurry-love"]).toBe("wireit");
    expect(wireit["sync:02-you-cant-hurry-love"]).toEqual({
      command: `${GIG}/sync-cli.ts "media/board.m4a" "media/02.mov" sync/02-you-cant-hurry-love.sync.json`,
      files: ["media/board.m4a", "media/02.mov"],
      output: ["sync/02-you-cant-hurry-love.sync.json"],
    });
  });

  it("takes a board-audio song's vocal from the board, over the span of its video", () => {
    const { wireit } = recipe();
    expect(wireit["vocals:02-you-cant-hurry-love"]).toEqual({
      command: `${GIG}/vocals-cli.ts "media/02.mov" work/02-you-cant-hurry-love.vocals.flac --board "media/board.m4a" --sync sync/02-you-cant-hurry-love.sync.json`,
      files: ["media/board.m4a", "media/02.mov"],
      output: ["work/02-you-cant-hurry-love.vocals.flac"],
      dependencies: ["sync:02-you-cant-hurry-love"],
    });
  });

  it("takes a phone-audio song's vocal from the phone, with nothing to cut", () => {
    const { wireit } = recipe();
    expect(wireit["vocals:01-seven-nation-army"]).toEqual({
      command: `${GIG}/vocals-cli.ts "media/01.mov" work/01-seven-nation-army.vocals.flac`,
      files: ["media/01.mov"],
      output: ["work/01-seven-nation-army.vocals.flac"],
    });
  });

  it("aligns the manifest's lyric lines against the vocal, then writes the captions", () => {
    const { wireit } = recipe();
    expect(wireit["lyrics:02-you-cant-hurry-love"]).toEqual({
      command: `npx tsx ../../../src/authoring/lyrics-text-cli.ts --manifest "${MANIFEST}" work/02-you-cant-hurry-love.lyrics.txt`,
      files: [MANIFEST],
      output: ["work/02-you-cant-hurry-love.lyrics.txt"],
    });
    expect(wireit["align:02-you-cant-hurry-love"]).toEqual({
      command:
        "npx tsx ../../../src/authoring/desilence-align-cli.ts work/02-you-cant-hurry-love.vocals.flac" +
        " --text work/02-you-cant-hurry-love.lyrics.txt -o work/02-you-cant-hurry-love.align.json",
      files: ["work/02-you-cant-hurry-love.vocals.flac", "work/02-you-cant-hurry-love.lyrics.txt"],
      output: ["work/02-you-cant-hurry-love.align.json"],
      dependencies: ["vocals:02-you-cant-hurry-love", "lyrics:02-you-cant-hurry-love"],
    });
    expect(wireit["captions:02-you-cant-hurry-love"]).toEqual({
      command: `${GIG}/captions-cli.ts work/02-you-cant-hurry-love.align.json captions/02-you-cant-hurry-love --sync sync/02-you-cant-hurry-love.sync.json`,
      files: ["work/02-you-cant-hurry-love.align.json", "sync/02-you-cant-hurry-love.sync.json"],
      output: ["captions/02-you-cant-hurry-love.srt", "captions/02-you-cant-hurry-love.words.json", "captions/02-you-cant-hurry-love.flags.json"],
      dependencies: ["align:02-you-cant-hurry-love"],
    });
    expect(wireit["captions:01-seven-nation-army"].command).toBe(
      `${GIG}/captions-cli.ts work/01-seven-nation-army.align.json captions/01-seven-nation-army`,
    );
  });

  it("runs every song's captions from one captions task", () => {
    const { scripts, wireit } = recipe();
    expect(scripts.captions).toBe("wireit");
    expect(wireit.captions.dependencies).toEqual(["captions:01-seven-nation-army", "captions:02-you-cant-hurry-love"]);
  });

  it("gives a phone-audio song no sync task", () => {
    const { scripts, wireit } = recipe();
    expect(wireit["sync:01-seven-nation-army"]).toBeUndefined();
    expect(scripts["sync:01-seven-nation-army"]).toBeUndefined();
  });

  it("runs every song's sync from one sync task", () => {
    const { scripts, wireit } = recipe();
    expect(scripts.sync).toBe("wireit");
    expect(wireit.sync.dependencies).toEqual(["sync:02-you-cant-hurry-love"]);
  });

  it("renders a board-audio song's review from its video, the board, its sync and its captions", () => {
    const { scripts, wireit } = recipe();
    expect(scripts["render:02-you-cant-hurry-love"]).toBe("wireit");
    expect(wireit["render:02-you-cant-hurry-love"]).toEqual({
      command:
        `${GIG}/render-cli.ts "media/02.mov" captions/02-you-cant-hurry-love.words.json renders/02-you-cant-hurry-love-16x9-review.mp4` +
        ` --board "media/board.m4a" --sync sync/02-you-cant-hurry-love.sync.json --mix 0.6`,
      files: ["media/02.mov", "captions/02-you-cant-hurry-love.words.json", "media/board.m4a", "sync/02-you-cant-hurry-love.sync.json"],
      output: ["renders/02-you-cant-hurry-love-16x9-review.mp4"],
      dependencies: ["captions:02-you-cant-hurry-love"],
    });
  });

  it("renders a phone-audio song's review without the board or a sync", () => {
    const { wireit } = recipe();
    expect(wireit["render:01-seven-nation-army"]).toEqual({
      command: `${GIG}/render-cli.ts "media/01.mov" captions/01-seven-nation-army.words.json renders/01-seven-nation-army-16x9-review.mp4`,
      files: ["media/01.mov", "captions/01-seven-nation-army.words.json"],
      output: ["renders/01-seven-nation-army-16x9-review.mp4"],
      dependencies: ["captions:01-seven-nation-army"],
    });
  });

  it("runs every song's render from one render task", () => {
    const { scripts, wireit } = recipe();
    expect(scripts.render).toBe("wireit");
    expect(wireit.render.dependencies).toEqual(["render:01-seven-nation-army", "render:02-you-cant-hurry-love"]);
  });

  it("passes a song's cut to its render, so changing it re-renders the song", () => {
    expect(recipe({ in: 12.5, out: 190 }).wireit["render:02-you-cant-hurry-love"].command).toMatch(/ --in 12\.5 --out 190$/);
    expect(recipe({ out: 190 }).wireit["render:02-you-cant-hurry-love"].command).toMatch(/--mix 0\.6 --out 190$/);
  });

  it("transcribes what was said around each song, from the vocal it was aligned on", () => {
    const { scripts, wireit } = recipe();
    expect(wireit["edges:02-you-cant-hurry-love"]).toEqual({
      command:
        `${GIG}/edges-cli.ts work/02-you-cant-hurry-love.vocals.flac work/02-you-cant-hurry-love.align.json edges/02-you-cant-hurry-love.json` +
        " --sync sync/02-you-cant-hurry-love.sync.json",
      files: ["work/02-you-cant-hurry-love.vocals.flac", "work/02-you-cant-hurry-love.align.json", "sync/02-you-cant-hurry-love.sync.json"],
      output: ["edges/02-you-cant-hurry-love.json"],
      dependencies: ["align:02-you-cant-hurry-love"],
    });
    expect(wireit["edges:01-seven-nation-army"].command).toBe(
      `${GIG}/edges-cli.ts work/01-seven-nation-army.vocals.flac work/01-seven-nation-army.align.json edges/01-seven-nation-army.json`,
    );
    expect(scripts.edges).toBe("wireit");
    expect(wireit.edges.dependencies).toEqual(["edges:01-seven-nation-army", "edges:02-you-cant-hurry-love"]);
  });

  it("names files by position in gig.json and the song folder, the same on every read", () => {
    const a = recipe();
    const b = gigRecipe(readGig(gig, root), "../../..") as Recipe;
    expect(b).toEqual(a);
    expect(a.wireit["sync:02-you-cant-hurry-love"].output).toEqual(["sync/02-you-cant-hurry-love.sync.json"]);
  });
});

describe("stamp", () => {
  let root: string, gig: string;
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

  /** clickbAIt at the root and the songs repo nested in songs/, as in the real checkout. */
  beforeEach(() => {
    ({ root, gig } = layout());
    const songs = join(root, "songs");
    writeFileSync(join(root, ".gitignore"), "songs/\n");
    writeFileSync(join(songs, "README"), "songs\n");
    for (const repo of [root, songs]) {
      git(repo, "init", "-q");
      git(repo, "add", "-A");
      git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
    }
  });

  const lock = () => JSON.parse(readFileSync(join(gig, "gig.lock.json"), "utf8"));

  it("records the commits both repos are at", () => {
    stamp(gig, root);
    expect(lock()).toEqual({ songs: git(join(root, "songs"), "rev-parse", "HEAD"), clickbait: git(root, "rev-parse", "HEAD") });
  });

  it("records commits passed in instead, expanded to full SHAs", () => {
    const songs = git(join(root, "songs"), "rev-parse", "HEAD");
    const clickbait = git(root, "rev-parse", "HEAD");
    stamp(gig, root, { songs: songs.slice(0, 7), clickbait: clickbait.slice(0, 7) });
    expect(lock()).toEqual({ songs, clickbait });
  });

  it("rejects a commit the repo doesn't have", () => {
    expect(() => stamp(gig, root, { clickbait: "0000000" })).toThrow(/0000000/);
    expect(existsSync(join(gig, "gig.lock.json"))).toBe(false);
  });

  it("never overwrites an existing lock", () => {
    writeFileSync(join(gig, "gig.lock.json"), "{}");
    expect(() => stamp(gig, root)).toThrow(/gig.lock.json/);
    expect(readFileSync(join(gig, "gig.lock.json"), "utf8")).toBe("{}");
  });

  it("refuses a checkout with uncommitted changes, since its commit doesn't recreate it", () => {
    writeFileSync(join(root, ".gitignore"), "songs/\nchanged\n");
    expect(() => stamp(gig, root)).toThrow(/clickbait.*uncommitted/i);
    expect(existsSync(join(gig, "gig.lock.json"))).toBe(false);
  });

  it("stamps an uncommitted checkout when forced, and says which repo was dirty", () => {
    writeFileSync(join(root, ".gitignore"), "songs/\nchanged\n");
    stamp(gig, root, { force: true });
    expect(lock().dirty).toEqual(["clickbait"]);
  });

  it("doesn't count the gig's own folder as uncommitted songs-repo work", () => {
    writeGig(gig, { songs: [] });
    stamp(gig, root);
    expect(lock().dirty).toBeUndefined();
  });
});
