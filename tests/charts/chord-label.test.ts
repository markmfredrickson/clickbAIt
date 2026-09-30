import { describe, it, expect } from "vitest";
import { chordName, transposeChord, toHarte } from "../../src/charts/chord-label.js";

describe("chordName", () => {
  it("reads Harte shorthands", () => {
    const labels = ["A:maj7", "F#:min7", "E:7", "B:hdim7", "C:dim7", "D:min", "G:maj", "Bb:sus4", "A:min6", "A:minmaj7", "Eb:aug", "D:9"];
    expect(labels.map(chordName)).toEqual(["Amaj7", "F#m7", "E7", "Bm7b5", "Cdim7", "Dm", "G", "Bbsus4", "Am6", "Am(maj7)", "Ebaug", "D9"]);
  });

  it("reads a bare Harte root as major", () => {
    expect(chordName("A")).toBe("A");
  });

  it("spells a Harte bass degree as a note", () => {
    expect(["E:maj/3", "A:min/b3", "D:7/b7", "Db:maj/5", "C/5"].map(chordName)).toEqual(["E/G#", "Am/C", "D7/C", "Db/Ab", "C/G"]);
  });

  it("reads N as no chord", () => {
    expect(chordName("N")).toBe("N.C.");
  });

  it("passes plain chord names through", () => {
    const names = ["E/G#", "C#m", "Amaj7", "F#m7", "Bbsus4", "Gadd9", "N.C."];
    expect(names.map(chordName)).toEqual(names);
  });

  it("rejects X and anything else it can't read", () => {
    for (const bad of ["X", "H:maj", "A:foo", "A:(1,3,5)", "", "Am/3x", "hello"]) {
      expect(() => chordName(bad), bad).toThrow();
    }
  });
});

describe("transposeChord", () => {
  it("moves the root and bass and spells them in the target key", () => {
    expect(transposeChord("Gb", -4, "A")).toBe("D");
    expect(transposeChord("Bb:min7", -4, "A")).toBe("F#m7");
    expect(transposeChord("Ab:7/3", -4, "A")).toBe("E7/G#");
    expect(transposeChord("Db/Ab", -4, "A")).toBe("A/E");
  });

  it("uses flats in a flat key and sharps otherwise", () => {
    expect(transposeChord("C", 1, "F")).toBe("Db");
    expect(transposeChord("C", 1, "G")).toBe("C#");
    expect(transposeChord("C", 1, "Dm")).toBe("Db");
    expect(transposeChord("C", 1, "Em")).toBe("C#");
  });

  it("leaves no-chord alone", () => {
    expect(transposeChord("N", -4, "A")).toBe("N.C.");
  });
});

describe("toHarte", () => {
  it("writes chord names as Harte labels that read back the same", () => {
    const names = ["A", "F#m7", "Amaj7", "E7", "E/G#", "Bm", "Dmaj7", "C#m", "Bbsus4", "N.C."];
    expect(names.map(toHarte)).toEqual(["A:maj", "F#:min7", "A:maj7", "E:7", "E:maj/3", "B:min", "D:maj7", "C#:min", "Bb:sus4", "N"]);
    expect(names.map(toHarte).map(chordName)).toEqual(names);
  });

  it("keeps a name with no Harte shorthand as the plain name", () => {
    expect(toHarte("Gadd9")).toBe("Gadd9");
  });
});
