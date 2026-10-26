import { describe, it, expect, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
      { n: "01", slug: "seven-nation-army", dir: join(root, SNA), phone: "media/01.mov", audio: "phone" },
      { n: "02", slug: "you-cant-hurry-love", dir: join(root, YCHL), phone: "media/02.mov", audio: "board" },
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

  it("rejects a song folder that doesn't exist", () => {
    writeGig(gig, { board: "media/board.m4a", songs: [{ song: "songs/band/nobody/nothing", phone: "media/02.mov" }] });
    expect(() => readGig(gig, root)).toThrow(/songs\/band\/nobody\/nothing/);
  });
});

describe("gigRecipe", () => {
  let root: string, gig: string;
  beforeEach(() => ({ root, gig } = layout()));

  function recipe(): Recipe {
    writeGig(gig, {
      board: "media/board.m4a",
      songs: [
        { song: SNA, phone: "media/01.mov", audio: "phone" },
        { song: YCHL, phone: "media/02.mov" },
      ],
    });
    return gigRecipe(readGig(gig, root), "../../..") as Recipe;
  }

  it("syncs each board-audio song's phone video against the board", () => {
    const { scripts, wireit } = recipe();
    expect(scripts["sync:02-you-cant-hurry-love"]).toBe("wireit");
    expect(wireit["sync:02-you-cant-hurry-love"]).toEqual({
      command:
        'mkdir -p sync && ../../../.claude/skills/clickbait/bin/clickbait-audio offset "media/board.m4a" "media/02.mov"' +
        " > sync/02-you-cant-hurry-love.sync.json",
      files: ["media/board.m4a", "media/02.mov"],
      output: ["sync/02-you-cant-hurry-love.sync.json"],
    });
  });

  it("gives a phone-audio song no sync task", () => {
    const { scripts, wireit } = recipe();
    expect(Object.keys(wireit).filter((t) => t.includes("seven-nation-army"))).toEqual([]);
    expect(Object.keys(scripts).filter((t) => t.includes("seven-nation-army"))).toEqual([]);
  });

  it("runs every song's sync from one sync task", () => {
    const { scripts, wireit } = recipe();
    expect(scripts.sync).toBe("wireit");
    expect(wireit.sync.dependencies).toEqual(["sync:02-you-cant-hurry-love"]);
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
