import { describe, it, expect } from "vitest";
import { stemsSend } from "../../src/teleprompter/stems-hold.js";

// Bail mutes the Stems folder and coming back puts it as it was. The folder is
// muted by default, so a return must never unmute stems that were off.
describe("stemsSend", () => {
  it("mutes stems that were playing, and unmutes them on the way back", () => {
    const out = stemsSend(false, undefined, false);
    expect(out).toEqual({ mute: true, held: false });
    expect(stemsSend(true, out.held, true)).toEqual({ mute: false, held: undefined });
  });

  it("leaves stems muted on the way back when they were muted before", () => {
    const out = stemsSend(false, undefined, true);
    expect(out).toEqual({ mute: true, held: true });
    expect(stemsSend(true, out.held, true)).toEqual({ mute: true, held: undefined });
  });

  it("treats an unknown state as muted, the projects' default", () => {
    const out = stemsSend(false, undefined, undefined);
    expect(stemsSend(true, out.held, true)).toEqual({ mute: true, held: undefined });
  });

  it("keeps the first saved state through a second silence", () => {
    const first = stemsSend(false, undefined, false);
    const second = stemsSend(false, first.held, true);
    expect(second.held).toBe(false);
  });

  it("sends nothing on a return when nothing was silenced", () => {
    expect(stemsSend(true, undefined, false)).toEqual({ held: undefined });
  });
});
