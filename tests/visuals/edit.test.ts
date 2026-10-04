import { describe, expect, it } from "vitest";
import { checkRules, credits, layout, shotFiles, shotTiming, visualsPackage, type Edit } from "../../src/visuals/edit.js";

// 120 bpm in 4/4: a bar is 2 s.
const BAR = 2;

function edit(): Edit {
  return {
    bpm: 120,
    beatsPerBar: 4,
    preRollBars: 2,
    ringOutBars: 1,
    songBars: 4,
    output: { width: 640, height: 360, fps: 24 },
    dissolve: 0.5,
    film: ["noise=alls=10"],
    looks: { green: ["eq=saturation=0.8"], night: ["eq=saturation=0.7"] },
    clips: {
      key: { file: "../footage/key.mp4" },
      road: { file: "../footage/road.mp4" },
      radio: { file: "../footage/radio.mp4" },
      field: { file: "../footage/field.mp4" },
      sky: { file: "../footage/sky.mp4" },
    },
    sections: [
      { name: "Preroll", look: "green", shots: [{ clip: "key", bars: 1, kind: "close" }, { clip: "road", bars: 1, kind: "road", anchor: "start" }] },
      { name: "Intro", look: "green", shots: [{ clip: "radio", bars: 1, kind: "close", from: 5.3 }, { clip: "field", bars: 3, kind: "land" }] },
      { name: "Outro", look: "night", shots: [{ clip: "sky", bars: 1, kind: "sky" }] },
    ],
  };
}

describe("layout", () => {
  it("places every shot on the bar grid, with its section's look", () => {
    const shots = layout(edit());
    expect(shots.map(s => [s.index, s.section, s.look, s.startBar, s.start, s.dur])).toEqual([
      [0, "Preroll", "green", 0, 0, BAR],
      [1, "Preroll", "green", 1, BAR, BAR],
      [2, "Intro", "green", 2, 2 * BAR, BAR],
      [3, "Intro", "green", 3, 3 * BAR, 3 * BAR],
      [4, "Outro", "night", 6, 6 * BAR, BAR],
    ]);
  });

  it("starts the intro on the downbeat after the preroll", () => {
    const intro = layout(edit()).find(s => s.section === "Intro")!;
    expect(intro.startBar).toBe(edit().preRollBars);
  });

  it("refuses an edit whose bars don't fill preroll + song + ring-out", () => {
    const e = edit();
    e.sections[1].shots[1].bars = 2;
    expect(() => layout(e)).toThrow(/6 bars.*want 7/);
  });

  it("lets a shot override its section's look", () => {
    const e = edit();
    e.sections[2].shots[0].look = "green";
    expect(layout(e)[4].look).toBe("green");
  });
});

describe("shotFiles", () => {
  it("writes one file per shot, named by its clip, carrying everything its render reads", () => {
    const files = shotFiles(edit());
    expect(Object.keys(files)).toEqual(["shots/key.json", "shots/road.json", "shots/radio.json", "shots/field.json", "shots/sky.json"]);
    const shot = JSON.parse(files["shots/radio.json"]);
    expect(shot).toMatchObject({ clip: "radio", file: "../footage/radio.mp4", kind: "close", from: 5.3, look: ["eq=saturation=0.8"], width: 640, height: 360, fps: 24 });
    expect(shot.dur).toBeCloseTo(BAR + 0.5); // a shot runs half a dissolve into each neighbour
  });

  it("names a clip's later uses by their count", () => {
    const e = edit();
    e.sections[1].shots = [{ clip: "radio", bars: 1, kind: "close" }, { clip: "field", bars: 2, kind: "land" }, { clip: "road", bars: 1, kind: "road" }];
    expect(Object.keys(shotFiles(e))).toContain("shots/road.2.json");
  });

  it("changes exactly one file when one shot changes", () => {
    const before = shotFiles(edit());
    const e = edit();
    e.sections[1].shots[1].from = 2;
    const after = shotFiles(e);
    const changed = Object.keys(before).filter(k => before[k] !== after[k]);
    expect(changed).toEqual(["shots/field.json"]);
  });

  it("leaves every other shot's file alone when a shot is inserted", () => {
    const before = shotFiles(edit());
    const e = edit();
    e.sections[1].shots[1].bars = 2;
    e.sections[1].shots.splice(1, 0, { clip: "key", bars: 1, kind: "land", from: 3 });
    const after = shotFiles(e);
    expect(Object.keys(after).filter(k => before[k] !== after[k])).toEqual(["shots/key.2.json", "shots/field.json"]);
  });

  it("changes only that look's shots when a look changes", () => {
    const before = shotFiles(edit());
    const e = edit();
    e.looks.night = ["eq=saturation=0.6"];
    const after = shotFiles(e);
    expect(Object.keys(before).filter(k => before[k] !== after[k])).toEqual(["shots/sky.json"]);
  });
});

describe("checkRules", () => {
  it("is quiet on an edit that keeps the rules", () => {
    expect(checkRules(layout(edit()))).toEqual([]);
  });

  it("flags two close-ups back to back", () => {
    const e = edit();
    e.sections[1].shots.unshift({ clip: "key", bars: 1, kind: "close", from: 2 });
    e.sections[1].shots[2].bars = 2;
    expect(checkRules(layout(e))).toContainEqual(expect.stringMatching(/close-ups back to back.*shot 2.*shot 3/));
  });

  it("flags road after road, even with a close-up between them", () => {
    const e = edit();
    e.sections[1].shots = [{ clip: "radio", bars: 1, kind: "close" }, { clip: "road", bars: 2, kind: "road" }, { clip: "field", bars: 1, kind: "land" }];
    expect(checkRules(layout(e))).toContainEqual(expect.stringMatching(/road after road/));
  });

  it("flags a landscape used twice, but lets roads repeat", () => {
    const e = edit();
    e.sections[2].shots = [{ clip: "field", bars: 1, kind: "land" }];
    expect(checkRules(layout(e))).toContainEqual(expect.stringMatching(/field.*used 2 times/));
    const roads = edit();
    roads.sections[1].shots = [{ clip: "radio", bars: 1, kind: "close" }, { clip: "field", bars: 2, kind: "land" }, { clip: "road", bars: 1, kind: "road" }];
    expect(checkRules(layout(roads)).filter(w => /used/.test(w))).toEqual([]);
  });
});

describe("credits", () => {
  it("credits each used clip's maker once, in order of first appearance, grouped by where it came from", () => {
    const e = edit();
    e.clips.key = { ...e.clips.key, by: "Ann Lee", license: "pexels" };
    e.clips.road = { ...e.clips.road, by: "National Park Service", license: "public-domain" };
    e.clips.field = { ...e.clips.field, by: "Ann Lee", license: "pexels" };
    e.clips.sky = { ...e.clips.sky, by: "Bo Diaz", license: "pexels" };
    e.clips.unused = { file: "../footage/unused.mp4", by: "Cy Young", license: "pexels" };
    e.sounds = [{ file: "../footage/engine.mp3", at: 0, by: "motorhead99", license: "cc0" }];
    expect(credits(e)).toEqual([
      { heading: "Footage", names: ["Ann Lee", "National Park Service", "Bo Diaz"] },
      { heading: "Sound", names: ["motorhead99"] },
    ]);
  });
});

describe("visualsPackage", () => {
  const pkg = visualsPackage(edit(), { rel: "../../../..", slug: "song-artist", audio: "../song-artist.opus" }) as {
    scripts: Record<string, string>;
    wireit: Record<string, { command: string; files?: string[]; output?: string[]; dependencies?: string[] }>;
  };

  it("has one task per shot, reading its shot file and its source", () => {
    expect(pkg.wireit["shot-field"]).toEqual({
      command: "npx tsx ../../../../src/visuals/edit-cli.ts shot shots/field.json",
      files: ["shots/field.json", "../footage/field.mp4"],
      output: [".shots/field.mp4"],
    });
  });

  it("renders the credits from their own file", () => {
    expect(pkg.wireit.credits).toMatchObject({ files: ["credits.json"], output: [".shots/credits.mp4"] });
  });

  it("assembles after every shot and the credits, into the song's visuals file", () => {
    const a = pkg.wireit.assemble;
    expect(a.dependencies).toEqual(["shot-key", "shot-road", "shot-radio", "shot-field", "shot-sky", "credits"]);
    expect(a.files).toEqual(expect.arrayContaining([".shots/*.mp4", "edit.json", "../song-artist.opus"]));
    expect(a.output).toEqual(["song-artist.visuals.mp4", "song-artist.visuals-review.mp4"]);
    expect(pkg.scripts.assemble).toBe("wireit");
  });
});

describe("shotTiming", () => {
  // a 4 s shot (dur) from a 20 s clip
  it("plays from the middle of the usable part by default", () => {
    const t = shotTiming({ kind: "land", dur: 4, from: 2, to: 18 }, 20);
    expect(t.speed).toBe(1);
    expect(t.start).toBeCloseTo(8, 1);
  });
  it("plays from the start of the usable part when anchored there (an entrance, a drive-over)", () => {
    expect(shotTiming({ kind: "road", dur: 4, from: 2, anchor: "start" }, 20).start).toBe(2);
  });
  it("speeds sky up by whole numbers, at most 3x, but not at night", () => {
    expect(shotTiming({ kind: "sky", dur: 4 }, 20).speed).toBe(3);
    expect(shotTiming({ kind: "sky", dur: 4 }, 10).speed).toBe(2);
    expect(shotTiming({ kind: "sky", dur: 4, night: true }, 20).speed).toBe(1);
  });
  it("keeps a speed the edit sets", () => {
    expect(shotTiming({ kind: "sky", dur: 4, speed: 0.5 }, 20).speed).toBe(0.5);
  });
  it("slows a source too short for the shot so it fills it", () => {
    const t = shotTiming({ kind: "land", dur: 4, from: 1, to: 3 }, 20);
    expect(t.start).toBe(1);
    expect(t.speed).toBeCloseTo((2 - 0.05) / 4);
  });
});
