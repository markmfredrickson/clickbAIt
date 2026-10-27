import { describe, it, expect } from "vitest";
import { finalGainDb, mixArgs, mixGains, reviewArgs, TARGET_LUFS } from "../src/gig/render.js";

const db = (gain: number) => 20 * Math.log10(gain);

describe("mixGains", () => {
  it("brings each source to the target loudness, then weights it by its share", () => {
    const g = mixGains({ boardLufs: -20, phoneLufs: -30, mix: 0.6 });
    expect(db(g.board)).toBeCloseTo(TARGET_LUFS + 20 + db(0.6), 9);
    expect(db(g.phone!)).toBeCloseTo(TARGET_LUFS + 30 + db(0.4), 9);
  });

  it("gives the phone nothing when the board takes the whole mix", () => {
    expect(mixGains({ boardLufs: -20, phoneLufs: -30, mix: 1 }).phone).toBe(0);
  });

  it("takes only the phone when there is no board", () => {
    const g = mixGains({ boardLufs: null, phoneLufs: -30, mix: 0 });
    expect(g.board).toBe(0);
    expect(db(g.phone)).toBeCloseTo(TARGET_LUFS + 30, 9);
  });
});

describe("finalGainDb", () => {
  it("moves the measured mix to the target", () => {
    expect(finalGainDb(-17.5)).toBeCloseTo(TARGET_LUFS + 17.5, 9);
  });
});

/** The value of the option after `flag` the nth time it appears. */
function opt(args: string[], flag: string, nth = 0): string {
  const at = args.flatMap((a, i) => (a === flag ? [i] : []))[nth];
  if (at === undefined) throw new Error(`no ${flag}`);
  return args[at + 1];
}

/** Stages of the filter graph that read the given labelled input, e.g. "[0:a]". */
function chain(args: string[], label: string): string {
  const graph = opt(args, "-filter_complex");
  const stage = graph.split(";").find((s) => s.startsWith(label));
  if (!stage) throw new Error(`no chain from ${label} in ${graph}`);
  return stage;
}

describe("mixArgs", () => {
  const gains = { board: 0.5, phone: 0.25 };

  it("cuts the board from the span start, for the span's length", () => {
    const args = mixArgs({ phone: "p.mov", board: "b.m4a", sync: { offset: 100, drift_ppm: -25 }, videoSeconds: 200, gains, out: "mix.flac" });
    expect(args).toContain("b.m4a");
    expect(Number(opt(args, "-ss"))).toBe(100);
    expect(Number(opt(args, "-t"))).toBeCloseTo(200 * (1 - 25e-6), 9);
    // The board is the second input: -ss and -t come before its -i.
    expect(args.indexOf("-ss")).toBeLessThan(args.lastIndexOf("-i"));
    expect(args.indexOf("-i")).toBeLessThan(args.indexOf("-ss"));
  });

  it("plays the board at the phone's clock rate, so it lasts as long as the video", () => {
    const args = mixArgs({ phone: "p.mov", board: "b.m4a", sync: { offset: 100, drift_ppm: -25 }, videoSeconds: 200, gains, out: "mix.flac" });
    const rate = Number(chain(args, "[1:a]").match(/asetrate=(\d+)/)![1]);
    const up = Number(chain(args, "[1:a]").match(/aresample=(\d+),asetrate/)![1]);
    // Rounding the relabelled rate leaves at most half a sample per second at the upsampled rate.
    expect(Math.abs(rate / up - (1 - 25e-6))).toBeLessThanOrEqual(0.5 / up);
    expect(chain(args, "[1:a]")).toContain("aresample=48000");
  });

  it("delays the board when the video started first", () => {
    const args = mixArgs({ phone: "p.mov", board: "b.m4a", sync: { offset: -3, drift_ppm: null }, videoSeconds: 200, gains, out: "mix.flac" });
    expect(Number(opt(args, "-ss"))).toBe(0);
    expect(chain(args, "[1:a]")).toMatch(/adelay=144000S:all=1/);
  });

  it("doesn't delay the board when the video started after it", () => {
    const args = mixArgs({ phone: "p.mov", board: "b.m4a", sync: { offset: 100, drift_ppm: null }, videoSeconds: 200, gains, out: "mix.flac" });
    expect(chain(args, "[1:a]")).not.toContain("adelay");
  });

  it("weights each source by its gain and mixes them for the length of the video", () => {
    const args = mixArgs({ phone: "p.mov", board: "b.m4a", sync: { offset: 100, drift_ppm: null }, videoSeconds: 200, gains, out: "mix.flac" });
    expect(chain(args, "[0:a]")).toContain("volume=0.25");
    expect(chain(args, "[1:a]")).toContain("volume=0.5");
    expect(opt(args, "-filter_complex")).toMatch(/amix=inputs=2:duration=first:normalize=0/);
    expect(args[args.length - 1]).toBe("mix.flac");
  });

  it("reads no board at all for a phone-audio song", () => {
    const args = mixArgs({ phone: "p.mov", videoSeconds: 200, gains: { board: 0, phone: 0.25 }, out: "mix.flac" });
    expect(args.filter((a) => a === "-i")).toHaveLength(1);
    expect(args).not.toContain("-ss");
    expect(opt(args, "-filter_complex")).not.toContain("amix");
    expect(chain(args, "[0:a]")).toContain("volume=0.25");
  });
});

describe("reviewArgs", () => {
  const args = reviewArgs({ phone: "p.mov", mix: "mix.flac", srt: "s.srt", gainDb: 3.5, out: "r.mp4" });

  it("takes the picture from the phone, scaled to 720p", () => {
    expect(args.slice(0, args.indexOf("-i", args.indexOf("-i") + 1))).toContain("p.mov");
    expect(args.join(" ")).toContain("-map 0:v:0");
    expect(opt(args, "-vf")).toBe("scale=-2:720");
  });

  it("takes the sound from the mix, brought to the target and limited", () => {
    expect(args.join(" ")).toContain("-map 1:a:0");
    expect(opt(args, "-af")).toBe("volume=3.5dB,alimiter=limit=-1.5dB:level=disabled");
  });

  it("attaches the SRT as a subtitle track, off until chosen", () => {
    expect(args.join(" ")).toContain("-map 2:s:0");
    expect(opt(args, "-c:s")).toBe("mov_text");
    expect(opt(args, "-disposition:s:0")).toBe("0");
    expect(args[args.length - 1]).toBe("r.mp4");
  });

  it("renders the whole video when there is no cut", () => {
    expect(args).not.toContain("-ss");
    expect(args).not.toContain("-to");
  });

  it("cuts the picture and the mix to the same stretch, and leaves the already-cut captions alone", () => {
    const cut = reviewArgs({ phone: "p.mov", mix: "mix.flac", srt: "s.srt", gainDb: 0, cut: { in: 15, out: 170 }, out: "r.mp4" });
    /** The five arguments before an input file. */
    const before = (file: string) => cut.slice(cut.indexOf(file) - 5, cut.indexOf(file));
    expect(before("p.mov")).toEqual(["-ss", "15", "-to", "170", "-i"]);
    expect(before("mix.flac")).toEqual(["-ss", "15", "-to", "170", "-i"]);
    expect(before("s.srt").slice(-1)).toEqual(["-i"]);
    expect(cut.filter((a) => a === "-ss")).toHaveLength(2);
  });

  it("cuts from the start or to the end when only one side is given", () => {
    const from = reviewArgs({ phone: "p.mov", mix: "mix.flac", srt: "s.srt", gainDb: 0, cut: { in: 15 }, out: "r.mp4" });
    expect(from.filter((a) => a === "-ss")).toHaveLength(2);
    expect(from).not.toContain("-to");
    const to = reviewArgs({ phone: "p.mov", mix: "mix.flac", srt: "s.srt", gainDb: 0, cut: { out: 170 }, out: "r.mp4" });
    expect(to).not.toContain("-ss");
    expect(to.filter((a) => a === "-to")).toHaveLength(2);
  });
});
