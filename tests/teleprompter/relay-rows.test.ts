import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { startRelay } from "../../src/teleprompter/relay.js";
import { clientDir } from "../../src/teleprompter/build-client.js";
import type { LyricsDisplay } from "../../src/teleprompter/lyrics-display.js";

const SONG: LyricsDisplay = {
  schema: "clickbait/lyrics-display@1",
  title: "Test Song",
  bpm: 120,
  timeSignature: [4, 4],
  slug: "test-song",
  curve: [{ t: 0, b: 0 }, { t: 0.5, b: 1 }],
  words: [{ text: "w", startBeat: 1, endBeat: 2 }],
  display: { sections: [{ name: "Verse", startBeat: 0, bars: 2 }], lines: [{ words: [0, 0] }] },
};

let relay: ReturnType<typeof startRelay> | null = null;
let dir: string;

async function start(files: Record<string, unknown>): Promise<string> {
  dir = mkdtempSync(join(tmpdir(), "relay-rows-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), JSON.stringify(body));
  relay = startRelay({ httpPort: 0, oscPort: 0, songsDirs: [dir], clientDir, song: SONG });
  await new Promise<void>((r) => (relay!.server.listening ? r() : relay!.server.once("listening", () => r())));
  return `http://127.0.0.1:${(relay.server.address() as AddressInfo).port}`;
}

afterEach(() => {
  relay?.close();
  relay = null;
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /rows.json", () => {
  it("serves the song's rows file", async () => {
    const built = { schema: "clickbait/rows@1", slug: "test-song", title: "Test Song", sections: [], channels: [] };
    const base = await start({ "test-song.rows.json": built });
    expect(await (await fetch(`${base}/rows.json`)).json()).toEqual(built);
  });

  it("lays the rows out from the lyrics display for a song built before rows files", async () => {
    const base = await start({});
    const doc = await (await fetch(`${base}/rows.json`)).json();
    expect(doc.sections.map((s: { name: string }) => s.name)).toEqual(["Verse"]);
    expect(doc.channels.map((c: { id: string }) => c.id)).toEqual(["lyrics"]);
  });
});
