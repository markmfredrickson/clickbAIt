import { describe, it, expect } from "vitest";
import { resolve, dirname, join } from "path";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { buildRpp } from "../src/build/rpp.js";
import { linearize } from "../src/build/linearize.js";
import { song, seq, span, bars, cue, marker, audio } from "@clickbait/dsongl";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, "fixtures");

const defaultOpts = {
  cueDir: resolve(fixturesDir, "cues"),
  countDir: resolve(__dirname, "..", "assets", "counts"),
  clickDir: resolve(__dirname, "..", "assets", "clicks"),
  cueDuration: 0.8,
  countDuration: 0.4,
};

describe("buildRpp", () => {
  it("generates valid RPP structure", () => {
    const s = song("Test", 120,
      seq(
        span("Intro", bars(2)),
        span("Verse", bars(4)),
        span("Chorus", bars(4)),
      ),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    expect(rpp).toMatch(/^<REAPER_PROJECT/);
    expect(rpp).toMatch(/>$/);
  });

  it("includes tempo envelope", () => {
    const s = song("Test", 120,
      seq(
        span("Intro", bars(2)),
      ),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    expect(rpp).toContain("<TEMPOENVEX");
    expect(rpp).toContain("TEMPO 120");
  });

  it("emits a negative PROJOFFS measure offset so the downbeat reads as Bar 1", () => {
    const s = song("Test", 120,
      seq(
        span("Intro", bars(2)),
      ),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    // PROJOFFS <startTime> <measureOffset> <flag>: time 0 (positive timeline),
    // measure offset negative by the slug bars (count-in on negative bars).
    expect(rpp).toMatch(/PROJOFFS 0 -\d+ 0/);
  });

  it("halts the click item at clickDropBeat (click:false ring-out)", () => {
    const s = song("Test", 120,
      seq(
        span("A", bars(4)),
        span("Outro", bars(4)),   // starts at bar 5 = beat 16
      ),
    );
    // First LENGTH in the RPP is the click item's timeline span.
    const clickLen = (rpp: string) => Number(rpp.match(/LENGTH ([\d.]+)/)![1]);
    const full = clickLen(buildRpp(s, defaultOpts).rpp);
    const dropped = clickLen(buildRpp(s, { ...defaultOpts, clickDropBeat: 16 }).rpp);
    expect(dropped).toBeLessThan(full);           // click stops before the song end
    // Outro (beat 16) is 4 of the song's 8 bars in — the click loses ~that tail.
    const barSec = 4 * (60 / 120); // 2s/bar
    expect(full - dropped).toBeCloseTo(4 * barSec, 1); // 4 bars of click dropped
  });

  it("PROJOFFS offsets by the FULL pre-downbeat padding, not just the slug", () => {
    // A cue 12 beats before the downbeat forces padding past the 2-bar slug.
    // The live teleprompter reads /beat/str, so measure 1 must be the downbeat
    // (at paddingBeats) — offsetting by the slug alone leaves it a constant off.
    const s = song("Test", 120,
      seq(
        span("Intro", bars(4), [cue("Title", -12), marker("start", 0)]),
        span("Verse", bars(4)),
      ),
    );
    const { rpp, paddingBeats } = buildRpp(s, defaultOpts);
    const paddingBars = Math.round(paddingBeats / 4); // 120 BPM, 4/4
    expect(paddingBars).toBeGreaterThan(2); // padding really does exceed the slug
    expect(rpp).toContain(`PROJOFFS 0 ${-paddingBars} 0`);
  });

  describe("preRollBars: a lead before the slug", () => {
    // 120 BPM 4/4: a bar is 2 s. The fixture title fits a 2-bar slug.
    const s = song("Test", 120, span("Intro", bars(4)));
    const titleItem = (rpp: string) => {
      const i = rpp.indexOf("test.wav");
      const item = rpp.lastIndexOf("<ITEM", i);
      return Number(rpp.slice(item, i).match(/POSITION ([\d.]+)/)![1]);
    };
    const clickPosition = (rpp: string) => {
      const i = rpp.indexOf('NAME "Click source"');
      return Number(rpp.slice(rpp.lastIndexOf("<ITEM", i), i).match(/POSITION ([\d.]+)/)![1]);
    };
    const slugRegion = (rpp: string) => Number(rpp.match(/^  MARKER 1 ([\d.]+) \S+ 1 0 1 B/m)![1]);

    it("pads to preRollBars, with the extra bars ahead of the title, the slug and the click", () => {
      const { rpp, paddingBeats } = buildRpp(s, { ...defaultOpts, preRollBars: 8 });
      expect(paddingBeats).toBe(32);
      expect(rpp).toContain("PROJOFFS 0 -8 0");
      expect(slugRegion(rpp)).toBeCloseTo(12, 6); // 6 bars of lead
      expect(titleItem(rpp)).toBeCloseTo(12, 6);
      expect(clickPosition(rpp)).toBeCloseTo(12, 6);
    });

    it("changes nothing when preRollBars fits inside the slug", () => {
      const { rpp, paddingBeats } = buildRpp(s, { ...defaultOpts, preRollBars: 1 });
      expect(paddingBeats).toBe(8);
      expect(slugRegion(rpp)).toBe(0);
      expect(titleItem(rpp)).toBe(0);
      expect(clickPosition(rpp)).toBe(0);
    });
  });

  it("includes region markers for sections", () => {
    const s = song("Test", 120,
      seq(
        span("Intro", bars(2)),
        span("Verse", bars(4)),
      ),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    // First region uses the song slug (for teleprompter song switching)
    expect(rpp).toContain("MARKER 1");
    expect(rpp).toContain("test");
    expect(rpp).toContain("Verse");
    expect(rpp).toContain("MARKER 2");
  });

  it("places DSL cue events as audio items", () => {
    const s = song("Test", 120,
      seq(
        span("Intro", bars(4)),  // 16 beats
        span("Verse", bars(4), [cue("Verse", -8)]),  // cue 2 bars before
        span("Chorus", bars(4), [cue("Chorus", -8)]), // cue 2 bars before
      ),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    expect(rpp).toContain('"Cues & Counts"');
    expect(rpp).toContain(`${defaultOpts.cueDir}/verse.wav`);
    expect(rpp).toContain(`${defaultOpts.cueDir}/chorus.wav`);
  });

  it("places the section name + 2..N count in the bar before a cue section", () => {
    const s = song("Test", 120,
      seq(
        span("Intro", bars(4)),  // 16 beats
        span("Verse", bars(4), { cue: true }),  // starts beat 16
      ),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    // The count bar is 1 bar before the section (beat 12). Beat 1 is now the
    // section NAME (a pickup resolving onto the "1"); "2 3 4" fill the rest —
    // there is no separate "1.wav".
    expect(rpp).toContain(`${defaultOpts.cueDir}/verse.wav`);
    expect(rpp).toContain(`${defaultOpts.countDir}/2.wav`);
    expect(rpp).toContain(`${defaultOpts.countDir}/3.wav`);
    expect(rpp).toContain(`${defaultOpts.countDir}/4.wav`);
    expect(rpp).not.toContain(`${defaultOpts.countDir}/1.wav`);
  });

  it("counts a meter-change section in the PREVIOUS section's meter", () => {
    // B is 3/4 but its count-in sits in A's last bar (4/4), so it counts a full
    // 4 beats ("… 2 3 4"), not the new meter's 3 — counting the new meter would
    // land the numbers on the wrong beats of the old bar.
    const s = song("Test", 120, { timeSignature: [4, 4] },
      seq(
        span("Intro", bars(2)),                                        // 4/4
        span("Chorus", bars(2), { cue: true, timeSignature: [3, 4] }), // 3/4, follows 4/4
      ),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    expect(rpp).toContain(`${defaultOpts.countDir}/4.wav`); // 4th beat = old 4/4 meter
  });

  it("does not overflow a short old bar: a 5/4 section after a 2/4 pickup counts only 2", () => {
    const s = song("Test", 120, { timeSignature: [4, 4] },
      seq(
        span("Intro", bars(2)),                                        // 4/4
        span("Verse", bars(1), { timeSignature: [2, 4] }),             // 2/4 pickup (not cued)
        span("Chorus", bars(2), { cue: true, timeSignature: [5, 4] }), // 5/4, follows the 2/4
      ),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    // Count-in sits in the 2/4 pickup, so it's just "… 2" — never a 5/4 "… 5"
    // that would overflow the 2-beat bar and collide with the prior cue.
    expect(rpp).toContain(`${defaultOpts.countDir}/2.wav`);
    expect(rpp).not.toContain(`${defaultOpts.countDir}/5.wav`);
  });

  it("counts in the meter of the previous section's LAST bar", () => {
    // The Turnaround is 4/4 but ends on a 3/4 bar, so the Chorus counts 3.
    const s = song("Test", 120, { timeSignature: [4, 4] },
      seq(
        span("Turnaround", { beats: 7 }, [seq({ kind: "span", duration: bars(1) }, { kind: "span", duration: bars(1), timeSignature: [3, 4] })]),
        span("Chorus", bars(2), { cue: true }),
      ),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    expect(rpp).toContain(`${defaultOpts.countDir}/3.wav`);
    expect(rpp).not.toContain(`${defaultOpts.countDir}/4.wav`);
  });

  it("handles 5/4 time signature for counts", () => {
    const s = song("Test", 120, { timeSignature: [5, 4] },
      seq(
        span("Intro", bars(2)),  // 10 beats
        span("Head", bars(4), { cue: true }),   // starts beat 10
      ),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    // Count should have 5 beats
    expect(rpp).toContain(`${defaultOpts.countDir}/5.wav`);
  });

  it("reports unique cue WAVs needed from DSL cue events", () => {
    const s = song("Test", 120,
      seq(
        span("Intro", bars(4)),
        span("Verse", bars(4), [cue("Verse", -4)]),
        span("Chorus", bars(4), [cue("Chorus", -4)]),
        span("Verse", bars(4), [cue("Verse", -4)]),   // repeat
        span("Chorus", bars(4), [cue("Chorus", -4)]),  // repeat
      ),
    );
    const { cueWavsNeeded } = buildRpp(s, defaultOpts);
    // Title cue "Test" is always auto-injected
    expect(cueWavsNeeded.sort()).toEqual(["Chorus", "Test", "Verse"]);
  });

  it("skips cue/count placement when it would go before beat 0", () => {
    const s = song("Test", 120,
      seq(
        span("Intro", bars(1)), // only 4 beats — not enough for 2-bar cue lead
      ),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    // Intro starts at beat 0, cue would be at -8, count at -4 — both skipped
    // Should still have tracks but no items for Intro
    expect(rpp).toContain('"Cues & Counts"');
    expect(rpp).not.toContain(`${defaultOpts.cueDir}/intro.wav`);
  });

  it("cue with negative offset on first section pads and appears in RPP", () => {
    const s = song("Test", 120,
      seq(
        span("Intro", bars(4), [cue("Title", -12), cue("Intro", -4), marker("start", 0)]),
        span("Verse", bars(4), [cue("Verse", -4)]),
      ),
    );
    const { rpp, cueWavsNeeded } = buildRpp(s, defaultOpts);
    expect(cueWavsNeeded).toContain("Title");
    expect(cueWavsNeeded).toContain("Intro");
    expect(rpp).toContain(`${defaultOpts.cueDir}/title.wav`);
    expect(rpp).toContain(`${defaultOpts.cueDir}/intro.wav`);
    // Verify they're at different seconds by checking linearize directly
    const events = linearize(s);
    const titleCue = events.find(e => e.type === "cue" && e.value === "Title")!;
    const introCue = events.find(e => e.type === "cue" && e.value === "Intro")!;
    expect(titleCue.beat).toBe(0);
    expect(introCue.beat).toBe(8);
    expect(titleCue.seconds).toBe(0);
    expect(introCue.seconds).toBeGreaterThan(0);
  });

  it("includes click track with SOURCE CLICK", () => {
    const s = song("Test", 120,
      seq(
        span("Intro", bars(4)),
        span("Verse", bars(4)),
      ),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    expect(rpp).toContain("NAME Click");
    expect(rpp).toContain("<SOURCE CLICK");
    expect(rpp).toContain("AUTO 1 0");
    expect(rpp).toContain(`${defaultOpts.clickDir}/accent.wav`);
    expect(rpp).toContain(`${defaultOpts.clickDir}/beat.wav`);
  });

  it("generates SOURCE WAVE track for audio node", () => {
    const guitarsPath = resolve(fixturesDir, "stems", "guitars.wav");
    const s = song("Test", 120,
      seq(
        span("Intro", bars(2)),
        span("Verse", bars(4)),
      ),
      audio("Guitars", guitarsPath),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    expect(rpp).toContain("NAME Guitars");
    expect(rpp).toContain("<SOURCE WAVE");
    expect(rpp).toContain(`FILE ${guitarsPath} 1`);
  });

  it("generates SOURCE WAVE track for audio node with wav extension", () => {
    const padPath = resolve(fixturesDir, "stems", "pad.wav");
    const s = song("Test", 120,
      span("Intro", bars(2)),
      audio("Pad", padPath),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    expect(rpp).toContain("NAME Pad");
    expect(rpp).toContain("<SOURCE WAVE");
    expect(rpp).toContain(`FILE ${padPath} 1`);
  });

  it("groups multiple audio nodes by track name", () => {
    const guitarsPath = resolve(fixturesDir, "stems", "guitars.wav");
    const bassPath = resolve(fixturesDir, "stems", "bass.wav");
    const s = song("Test", 120,
      seq(
        span("Intro", bars(2)),
        span("Verse", bars(4)),
      ),
      audio("Guitars", guitarsPath),
      audio("Bass", bassPath),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    expect(rpp).toContain("NAME Guitars");
    expect(rpp).toContain("NAME Bass");
    // Should be separate tracks
    const trackCount = (rpp.match(/NAME Guitars|NAME Bass/g) ?? []).length;
    expect(trackCount).toBe(2);
  });

  it("wraps stems in a folder with the parent as a submix bus", () => {
    const guitarsPath = resolve(fixturesDir, "stems", "guitars.wav");
    const bassPath = resolve(fixturesDir, "stems", "bass.wav");
    const s = song("Test", 120,
      seq(span("Intro", bars(2)), span("Verse", bars(4))),
      audio("Guitars", guitarsPath),
      audio("Bass", bassPath),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    // A "Stems" folder parent exists and opens a folder.
    expect(rpp).toContain("NAME Stems");
    // Folder is balanced: exactly one opener and one closer across the stem block.
    expect((rpp.match(/ISBUS 1 1/g) ?? []).length).toBe(1);
    expect((rpp.match(/ISBUS 2 -1/g) ?? []).length).toBe(1);
    // The opener (parent) comes before the closer (last child).
    expect(rpp.indexOf("ISBUS 1 1")).toBeLessThan(rpp.indexOf("ISBUS 2 -1"));
  });

  it("emits no stems folder when the song has no audio", () => {
    const s = song("Test", 120,
      seq(span("Intro", bars(2)), span("Verse", bars(4))),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    expect(rpp).not.toContain("NAME Stems");
    expect(rpp).not.toContain("ISBUS 1 1");
    expect(rpp).not.toContain("ISBUS 2 -1");
  });

  it("includes SOFFS when audio has source offset", () => {
    const vocalsPath = resolve(fixturesDir, "stems", "vocals.wav");
    const s = song("Test", 120,
      span("Intro", bars(2)),
      audio("Vocals", vocalsPath, { soffs: 0.164 }),
    );
    const { rpp } = buildRpp(s, defaultOpts);
    expect(rpp).toContain("SOFFS 0.164");
  });

  describe("rig routing", () => {
    const vocalsPath = resolve(fixturesDir, "stems", "vocals.wav");
    const rig = {
      master: { hwout: { stereo: 17 as const } },
      generated: {
        click: { master: false, hwout: { mono: 20 as const }, muted: false, gain: 1 },
        cues: { master: false, hwout: { mono: 19 as const }, muted: false, gain: 1 },
        stems: { master: true, muted: true, gain: 0.708 },
      },
      bandBlock: { channels: 16, arm: true, roundTrip: true, names: { "1": "Guitar Kr" } },
      drums: [{ name: "X32 AUX 01/02 (Drums Mix)", channel: [21, 22] as [number, number], arm: true, roundTrip: true }],
    };
    const s = song("Test", 120,
      span("Intro", bars(2)),
      audio("Vocals", vocalsPath, {}),
    );

    it("emits MASTERHWOUT for the master output pair", () => {
      const { rpp } = buildRpp(s, { ...defaultOpts, rig });
      expect(rpp).toContain("MASTERHWOUT 16 0 1 0 0 0 0 -1");
    });

    it("routes click/cues off master to their mono hardware outs", () => {
      const { rpp } = buildRpp(s, { ...defaultOpts, rig });
      expect(rpp).toContain("HWOUT 1043 0 1 0 0 0 0 -1:U -1"); // click → mono 20
      expect(rpp).toContain("HWOUT 1042 0 1 0 0 0 0 -1:U -1"); // cues → mono 19
    });

    it("mutes the stems group parent, not individual stems, when the rig says so", () => {
      const { rpp } = buildRpp(s, { ...defaultOpts, rig });
      // The "Stems" folder parent carries the group mute...
      const parentBlock = rpp.slice(rpp.indexOf("NAME Stems"), rpp.indexOf("NAME Vocals"));
      expect(parentBlock).toMatch(/MUTESOLO 1 0 0/);
      // ...the individual stem is left unmuted.
      const vocalsBlock = rpp.slice(rpp.indexOf("NAME Vocals"));
      expect(vocalsBlock).toMatch(/MUTESOLO 0 0 0/);
    });

    it("adds armed round-trip record tracks (band block + drums)", () => {
      const { rpp } = buildRpp(s, { ...defaultOpts, rig });
      expect(rpp).toContain("X32 CH 01 (Guitar Kr)");
      expect(rpp).toContain("X32 CH 16");
      expect(rpp).toContain("X32 AUX 01/02 (Drums Mix)");
      // band ch1: armed, mono input 0, round-trip mono out 1024
      const ch1 = rpp.slice(rpp.indexOf("X32 CH 01"));
      expect(ch1).toMatch(/REC 1 0 1 0 0 0 0 0/);
      expect(ch1).toMatch(/HWOUT 1024 0 1 0 0 0 0 -1:U -1/);
    });

    it("emits no HWOUT or record tracks without a rig", () => {
      const { rpp } = buildRpp(s, defaultOpts);
      expect(rpp).not.toContain("HWOUT");
      expect(rpp).not.toContain("MASTERHWOUT");
      expect(rpp).not.toContain("X32 CH");
    });
  });

});

describe("buildRpp — practice-variant options", () => {
  const guitarsPath = resolve(fixturesDir, "stems", "guitars.wav");
  const bassPath = resolve(fixturesDir, "stems", "bass.wav");
  const s = song("Test", 120,
    seq(span("Intro", bars(2)), span("Verse", bars(4))),
    audio("Guitars", guitarsPath),
    audio("Bass", bassPath),
  );
  const trackBlock = (rpp: string, name: string) => {
    // Names with spaces are quoted in the RPP.
    const start = rpp.indexOf(`NAME ${/\s/.test(name) ? `"${name}"` : name}\n`);
    expect(start).toBeGreaterThan(-1);
    return rpp.slice(start, rpp.indexOf("\n  >", start));
  };

  it("mutes only the named stem track (siblings and the Stems parent stay live)", () => {
    const { rpp } = buildRpp(s, { ...defaultOpts, muteTracks: ["Bass"] });
    expect(trackBlock(rpp, "Bass")).toMatch(/MUTESOLO 1 0 0/);
    expect(trackBlock(rpp, "Guitars")).toMatch(/MUTESOLO 0 0 0/);
    expect(trackBlock(rpp, "Stems")).toMatch(/MUTESOLO 0 0 0/);
  });

  it("mutes every stem for a click-only render while click and cues stay live", () => {
    const { rpp } = buildRpp(s, { ...defaultOpts, muteTracks: ["Guitars", "Bass"] });
    expect(trackBlock(rpp, "Guitars")).toMatch(/MUTESOLO 1 0 0/);
    expect(trackBlock(rpp, "Bass")).toMatch(/MUTESOLO 1 0 0/);
    expect(trackBlock(rpp, "Click")).toMatch(/MUTESOLO 0 0 0/);
    expect(trackBlock(rpp, "Cues & Counts")).toMatch(/MUTESOLO 0 0 0/);
  });

  it("rejects a muteTracks name that matches no stem track", () => {
    expect(() => buildRpp(s, { ...defaultOpts, muteTracks: ["Keys"] })).toThrow(/Keys/);
  });

  it("renders to the song slug by default and to renderName when given", () => {
    expect(buildRpp(s, defaultOpts).rpp).toContain("RENDER_PATTERN test\n");
    expect(buildRpp(s, { ...defaultOpts, renderName: "test.minus-bass" }).rpp)
      .toContain("RENDER_PATTERN test.minus-bass\n");
  });
});

describe("buildRpp — the last stem item never plays source past sourceEnd", () => {
  // A 20 s silent WAV: long enough that the file length never caps an item, so
  // only sourceEnd (or the song end) can. The content doesn't matter here.
  const longWav = join(mkdtempSync(join(tmpdir(), "clickbait-rpp-")), "long.wav");
  const rate = 8000;
  const samples = 20 * rate;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + samples * 2, 4); wav.write("WAVE", 8);
  wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
  writeFileSync(longWav, wav);

  // The recording plays at the song tempo (120 bpm): beat n at source n * 0.5 s.
  const beatsThrough = (last: number) => Array.from({ length: last + 1 }, (_, n) => ({ time: n * 0.5 }));

  /** The source second each stem item has reached when it ends: its last stretch
   *  marker, plus the stretch-free (1:1) tail the item plays after that marker. */
  const sourceAtEnd = (rpp: string) =>
    rpp.split("<ITEM").slice(1)
      .filter((block) => block.includes(`FILE ${longWav}`))
      .map((block) => {
        const pairs = [...block.matchAll(/^\s*SM (.*)$/gm)].flatMap((m) => m[1].split(" + "));
        const [item, src] = pairs[pairs.length - 1].split(" ").map(Number);
        return src + Number(block.match(/LENGTH ([\d.]+)/)![1]) - item;
      });

  it("stops a ring-out at sourceEnd instead of playing on into the recording", () => {
    // Song ends on the bar-5 downbeat (beat 16 = source 8 s). sourceEnd keeps a
    // quarter second of the final hit; the bar of ring-out must not play the
    // recording's next bar (So Lonely: the fade-out would play after the hit).
    const s = song("Test", 120,
      span("A", bars(4)),
      audio("Stem", longWav, { sourceEnd: 8.25 }),
    );
    const { rpp } = buildRpp(s, { ...defaultOpts, recordingBeats: beatsThrough(39), ringOutSec: 2 });
    const ends = sourceAtEnd(rpp);
    expect(ends).toHaveLength(1);
    expect(ends[0]).toBeCloseTo(8.25, 6);
  });

  it("leaves a gap after the last clip silent instead of stretching the clip through it", () => {
    // Two clips replay source 0–4 s (beats 0–7) at song beats 0 and 8; song
    // beats 16–23 are a trailing silence clip (Dirty Work). The last clip must
    // end at its sourceEnd, not run on to the song end.
    const s = song("Test", 120,
      span("A", bars(6)),
      audio("Stem", longWav, { offset: 0, soffs: 0, sourceEnd: 4 }),
      audio("Stem", longWav, { offset: 8, soffs: 0, sourceEnd: 4 }),
    );
    const { rpp } = buildRpp(s, { ...defaultOpts, recordingBeats: beatsThrough(39) });
    expect(sourceAtEnd(rpp)).toEqual([expect.closeTo(4, 6), expect.closeTo(4, 6)]);
  });

  it("still plays a trailing smStride:0 outro 1:1 to the song end when there is no sourceEnd", () => {
    // Beats 16–23 are a free outro: no stretch markers, and no detected beats
    // after its downbeat (beat 16 = source 8 s). The item plays on from its last
    // marker at 1:1 to the song end, beat 24 = source 12 s.
    const s = song("Test", 120,
      seq(span("A", bars(4)), span("Outro", bars(2))),
      audio("Stem", longWav),
    );
    const { rpp } = buildRpp(s, {
      ...defaultOpts,
      recordingBeats: beatsThrough(16),
      strideRanges: [{ startBeat: 16, endBeat: 24, stride: 0 }],
    });
    const ends = sourceAtEnd(rpp);
    expect(ends).toHaveLength(1);
    expect(ends[0]).toBeCloseTo(12, 6);
  });
});
