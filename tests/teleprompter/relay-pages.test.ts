import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { startRelay } from "../../src/teleprompter/relay.js";
import { clientDir } from "../../src/teleprompter/build-client.js";
import { PRESETS, presetHref } from "../../src/teleprompter/display-options.js";

let relay: ReturnType<typeof startRelay>;
let base: string;
let songsDir: string;

beforeAll(async () => {
  songsDir = mkdtempSync(join(tmpdir(), "relay-pages-"));
  relay = startRelay({ httpPort: 0, oscPort: 0, songsDirs: [songsDir], clientDir });
  await new Promise<void>((r) => (relay.server.listening ? r() : relay.server.once("listening", () => r())));
  base = `http://127.0.0.1:${(relay.server.address() as AddressInfo).port}`;
});

afterAll(() => {
  relay.close();
  rmSync(songsDir, { recursive: true, force: true });
});

const page = async (path: string) => {
  const res = await fetch(base + path);
  return { status: res.status, text: await res.text() };
};

describe("join and picker pages", () => {
  it("offers every preset on the picker", async () => {
    const { status, text } = await page("/pick");
    expect(status).toBe(200);
    for (const p of PRESETS) expect(text).toContain(`href="${presetHref(p)}"`);
  });

  it("shows one QR code, to the picker, and no control link on the join page", async () => {
    const { text } = await page("/");
    expect(text.match(/<svg/g)).toHaveLength(1);
    expect(text).toContain("/pick");
    expect(text).not.toContain('href="/control"');
  });

  it("serves the prompter at /prompt, and still at /lyrics", async () => {
    const prompt = await page("/prompt?channels=chords");
    expect(prompt.status).toBe(200);
    expect(prompt.text).toContain('id="drawer"');
    expect((await page("/lyrics")).text).toBe(prompt.text);
  });
});
