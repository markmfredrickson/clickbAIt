import { describe, expect, it } from "vitest";
import { shotTiming, type Edit } from "../../src/visuals/edit.js";
import { fcpxml, resolveCut, type SourceInfo } from "../../src/visuals/resolve.js";

// 120 bpm in 4/4 at 24 fps: a bar is 2 s, 48 frames; the dissolve is 12 frames.
const BAR = 48;
const X = 12;

function edit(): Edit {
  return {
    bpm: 120,
    beatsPerBar: 4,
    preRollBars: 2,
    ringOutBars: 1,
    songBars: 4,
    output: { width: 640, height: 360, fps: 24 },
    dissolve: 0.5,
    film: [],
    looks: { green: [], night: [] },
    clips: {
      key: { file: "../footage/key.mp4" },
      road: { file: "../footage/road.mp4" },
      radio: { file: "../footage/radio.mp4" },
      field: { file: "../footage/field.mp4" },
      sky: { file: "../footage/sky.mp4" },
    },
    sections: [
      { name: "Preroll", look: "green", shots: [{ clip: "key", bars: 1, kind: "close" }, { clip: "road", bars: 1, kind: "road", anchor: "start", reverse: true }] },
      { name: "Intro", look: "green", shots: [{ clip: "radio", bars: 1, kind: "close", from: 5.3 }, { clip: "field", bars: 3, kind: "land" }] },
      { name: "Outro", look: "night", shots: [{ clip: "sky", bars: 1, kind: "sky" }] },
    ],
  };
}

const src = (name: string, duration: number, fps = 24): SourceInfo => ({ path: `/songs/a b/footage/${name}.mp4`, duration, fps, width: 1920, height: 1080 });
const sources: Record<string, SourceInfo> = {
  key: src("key", 10),
  road: src("road", 10, 30000 / 1001),
  radio: src("radio", 20),
  field: src("field", 30),
  sky: src("sky", 12),
};

describe("resolveCut: the edit as a timeline", () => {
  it("starts each dissolve on the frame its shot starts, as the ffmpeg build does", () => {
    const cut = resolveCut(edit(), sources);
    expect(cut.transitions).toEqual([1, 2, 3, 6].map(bar => ({ offset: bar * BAR, duration: X })));
  });

  it("cuts mid-dissolve and tiles the timeline from frame 0 to the end of the ring-out", () => {
    const cut = resolveCut(edit(), sources);
    expect(cut.clips.map(c => c.offset)).toEqual([0, BAR + X / 2, 2 * BAR + X / 2, 3 * BAR + X / 2, 6 * BAR + X / 2]);
    for (let i = 1; i < cut.clips.length; i++) expect(cut.clips[i - 1].offset + cut.clips[i - 1].duration).toBe(cut.clips[i].offset);
    expect(cut.duration).toBe(7 * BAR);
    expect(cut.clips.at(-1)!.offset + cut.clips.at(-1)!.duration).toBe(cut.duration);
  });

  it("shows each shot from its first frame where its dissolve begins", () => {
    const cut = resolveCut(edit(), sources);
    // local frame 0 of a shot plays when its dissolve starts, so a clip after a cut starts half a dissolve in
    expect(cut.clips.map(c => c.localStart)).toEqual([0, X / 2, X / 2, X / 2, X / 2]);
  });

  it("maps a shot onto its source where the ffmpeg build reads it", () => {
    const cut = resolveCut(edit(), sources);
    const radio = cut.clips[2];
    const t = shotTiming({ kind: "close", from: 5.3, dur: 2 + 0.5 }, 20);
    expect(radio.length).toBeCloseTo(2.5);
    expect(radio.map[0]).toEqual({ local: 0, src: t.start });
    expect(radio.map[1].src).toBeCloseTo(t.start + 2.5 * t.speed);
    expect(radio.retimed).toBe(false);
  });

  it("plays a reversed shot from the end of its read span back to its start", () => {
    const cut = resolveCut(edit(), sources);
    const road = cut.clips[1];
    const t = shotTiming({ kind: "road", anchor: "start", dur: 2.5 }, 10);
    // ffmpeg reads 0.3 s past the span, then reverses
    expect(road.map[0].src).toBeCloseTo(t.start + 2.5 * t.speed + 0.3);
    expect(road.map[1].src).toBeCloseTo(t.start + 0.3);
    expect(road.retimed).toBe(true);
  });

  it("speeds up a sky shot as the ffmpeg build does", () => {
    const sky = resolveCut(edit(), sources).clips[4];
    const t = shotTiming({ kind: "sky", dur: 2.5 }, 12);
    expect(t.speed).toBeGreaterThan(1);
    expect(sky.map[1].src - sky.map[0].src).toBeCloseTo(2.5 * t.speed);
    expect(sky.retimed).toBe(true);
  });

  it("marks each section where its first shot starts", () => {
    expect(resolveCut(edit(), sources).markers).toEqual([
      { frame: 0, name: "Preroll" },
      { frame: 2 * BAR, name: "Intro" },
      { frame: 6 * BAR, name: "Outro" },
    ]);
  });

  it("names each clip by its look, so a look's shots are easy to find and group", () => {
    expect(resolveCut(edit(), sources).clips.map(c => c.name)).toEqual(["green: key", "green: road", "green: radio", "green: field", "night: sky"]);
  });

  it("refuses a shot whose clip has no source", () => {
    const { sky: _, ...rest } = sources;
    expect(() => resolveCut(edit(), rest)).toThrow(/sky/);
  });
});

/** Every opened tag is closed, in order. */
function balanced(xml: string): boolean {
  const stack: string[] = [];
  for (const m of xml.replace(/<\?[^>]*\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>/g, "").matchAll(/<(\/?)([\w-]+)[^>]*?(\/?)>/g)) {
    if (m[3]) continue;
    if (!m[1]) stack.push(m[2]);
    else if (stack.pop() !== m[2]) return false;
  }
  return stack.length === 0;
}

describe("fcpxml", () => {
  const xml = () => fcpxml(resolveCut(edit(), sources), { title: "Test Song", sources, audio: [
    { name: "mix", path: "/songs/a b/mix.m4a", duration: 15 },
    { name: "sounds", path: "/songs/a b/sounds.wav", duration: 15 },
  ] });

  it("is well formed", () => {
    expect(xml()).toMatch(/^<\?xml/);
    expect(balanced(xml())).toBe(true);
  });

  it("starts the timeline at 0 at the output size and rate", () => {
    const x = xml();
    expect(x).toMatch(/<format id="r1" frameDuration="1\/24s" width="640" height="360"/);
    expect(x).toMatch(/<sequence format="r1" duration="336\/24s" tcStart="0s"/);
  });

  it("links each clip's file once, as a file URL", () => {
    const x = xml();
    expect(x.match(/<asset /g)).toHaveLength(7); // five clips, the mix and the sound effects
    expect(x).toContain('src="file:///songs/a%20b/footage/road.mp4"');
  });

  it("gives a source at another rate its own format", () => {
    expect(xml()).toMatch(/frameDuration="1001\/30000s"/);
  });

  it("writes a dissolve between every pair of shots", () => {
    expect(xml().match(/<transition /g)).toHaveLength(4);
  });

  it("retimes only the shots that need it", () => {
    expect(xml().match(/<timeMap>/g)).toHaveLength(2); // the reversed road and the sky
  });

  it("puts each audio file on its own lane under the picture, from time 0", () => {
    const x = xml();
    expect(x).toMatch(/<asset-clip[^>]*name="mix" lane="-1" offset="0s"/);
    expect(x).toMatch(/<asset-clip[^>]*name="sounds" lane="-2" offset="0s"/);
  });

  it("marks the sections", () => {
    expect(xml()).toContain('value="Intro"');
  });
});
