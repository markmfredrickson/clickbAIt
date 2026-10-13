import { describe, it, expect } from "vitest";
import { reaperDriver, type OscMessage } from "../../src/teleprompter/reaper-driver.js";

/** A driver whose messages land in a list instead of on a socket. */
function recorded() {
  const sent: OscMessage[] = [];
  return { sent, driver: reaperDriver((m) => sent.push(m)) };
}
const addresses = (ms: OscMessage[]) => ms.map((m) => m.address);

describe("reaperDriver", () => {
  it("plays and stops", () => {
    const { sent, driver } = recorded();
    driver.play();
    driver.stop();
    expect(addresses(sent)).toEqual(["/play", "/stop"]);
  });

  it("locates section k at region k+2 (region 1 is the title)", () => {
    const { sent, driver } = recorded();
    driver.locateSection(0);
    driver.locateSection(3);
    expect(addresses(sent)).toEqual(["/region/2", "/region/5"]);
  });

  it("selects tabs 1-10 with one action each, then nudges so REAPER names the song", () => {
    const { sent, driver } = recorded();
    driver.selectTab(1);
    expect(addresses(sent)).toEqual(["/action/3122", "/region/2", "/region/1"]);
    sent.length = 0;
    driver.selectTab(10);
    expect(addresses(sent)[0]).toBe("/action/3131");
  });

  it("reaches tabs past 10 from tab 10 with next-tab steps", () => {
    const { sent, driver } = recorded();
    driver.selectTab(13);
    expect(addresses(sent)).toEqual([
      "/action/3131",
      "/action/40861",
      "/action/40861",
      "/action/40861",
      "/region/2",
      "/region/1",
    ]);
  });

  it("refuses a tab below 1", () => {
    const { driver } = recorded();
    expect(() => driver.selectTab(0)).toThrow();
  });

  it("toggles the video window and its fullscreen", () => {
    const { sent, driver } = recorded();
    driver.toggleVideo();
    driver.toggleFullscreen();
    expect(addresses(sent)).toEqual(["/action/50125", "/action/50122"]);
  });

  it("sends every message with a float 1, the form REAPER's patterns expect", () => {
    const { sent, driver } = recorded();
    driver.play();
    driver.selectTab(2);
    for (const m of sent) expect(m.args).toEqual([1]);
  });
});
