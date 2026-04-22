import { describe, it, expect } from "vitest";
import { beatsToStretchMarkers, type Beat } from "../src/stretch-markers.js";

function mkBeats(times: number[]): Beat[] {
  return times.map(t => ({ time: t, strength: 1 }));
}

describe("beatsToStretchMarkers", () => {
  describe("stride option", () => {
    it("stride=1 (default) produces an SM for every beat", () => {
      const beats = mkBeats([0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5]);
      const markers = beatsToStretchMarkers(beats, { bpm: 120 });
      expect(markers).toHaveLength(8);
    });

    it("stride=1 explicit matches default", () => {
      const beats = mkBeats([0, 0.5, 1.0, 1.5]);
      const a = beatsToStretchMarkers(beats, { bpm: 120 });
      const b = beatsToStretchMarkers(beats, { bpm: 120, stride: 1 });
      expect(a).toEqual(b);
    });

    it("stride=4 keeps every 4th beat", () => {
      // 16 beats at 120 BPM = beat every 0.5s
      const times = Array.from({ length: 16 }, (_, i) => i * 0.5);
      const beats = mkBeats(times);
      const markers = beatsToStretchMarkers(beats, { bpm: 120, stride: 4 });
      expect(markers).toHaveLength(4);
      expect(markers.map(m => m.sourcePosition)).toEqual([0, 2.0, 4.0, 6.0]);
    });

    it("stride=4 keeps grid alignment (itemPosition uses original beat index)", () => {
      // At 120 BPM, 1 beat = 0.5s. With stride 4, markers should land at
      // grid positions 0, 4*0.5=2.0s, 8*0.5=4.0s, 12*0.5=6.0s.
      const times = Array.from({ length: 16 }, (_, i) => i * 0.5);
      const beats = mkBeats(times);
      const markers = beatsToStretchMarkers(beats, { bpm: 120, stride: 4 });
      expect(markers.map(m => m.itemPosition)).toEqual([0, 2.0, 4.0, 6.0]);
    });

    it("stride=4 with drifted source beats still maps to uniform grid", () => {
      // Source beats are imperfect (some drift) but should still be mapped
      // to a clean grid. Only every 4th is used.
      const beats = mkBeats([0, 0.48, 1.02, 1.49, 2.01, 2.47, 3.03, 3.48]);
      const markers = beatsToStretchMarkers(beats, { bpm: 120, stride: 4 });
      expect(markers).toHaveLength(2);
      expect(markers[0].sourcePosition).toBe(0);
      expect(markers[0].itemPosition).toBe(0);
      expect(markers[1].sourcePosition).toBe(2.01);
      expect(markers[1].itemPosition).toBe(2.0); // grid time, not drifted source
    });

    it("stride=4 with 10 beats yields markers at indices 0, 4, 8", () => {
      const times = Array.from({ length: 10 }, (_, i) => i * 0.5);
      const beats = mkBeats(times);
      const markers = beatsToStretchMarkers(beats, { bpm: 120, stride: 4 });
      expect(markers.map(m => m.beat)).toEqual([0, 4, 8]);
    });

    it("stride=2 keeps every other beat", () => {
      const times = Array.from({ length: 8 }, (_, i) => i * 0.5);
      const beats = mkBeats(times);
      const markers = beatsToStretchMarkers(beats, { bpm: 120, stride: 2 });
      expect(markers).toHaveLength(4);
      expect(markers.map(m => m.beat)).toEqual([0, 2, 4, 6]);
    });
  });
});
