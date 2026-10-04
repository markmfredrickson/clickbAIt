import { describe, it, expect } from "vitest";
import { prerollProblem } from "../src/visuals/edit.js";

describe("prerollProblem: the edit and the show track share time 0", () => {
  it("passes when the edit's preroll matches the manifest's", () => {
    expect(prerollProblem({ preRollBars: 8 }, 8)).toBeUndefined();
  });

  it("names both numbers when they differ", () => {
    expect(prerollProblem({ preRollBars: 8 }, 1)).toMatch(/edit\.json.*8.*1|8.*manifest.*1/);
  });
});
