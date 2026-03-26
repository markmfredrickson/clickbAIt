import { spawn } from "child_process";
import { writeFileSync, readFileSync, existsSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export const REAPER_BIN = "/Applications/REAPER.app/Contents/MacOS/REAPER";
export const reaperAvailable = existsSync(REAPER_BIN);

const POLL_MS = 200;
const TIMEOUT_MS = 20_000;

/**
 * Write an RPP to a temp file, run a Lua script against it in REAPER,
 * wait for completion, and return the modified RPP content.
 */
export async function reaperMutate(rppContent: string, lua: string): Promise<string> {
  const id = Date.now();
  const rppPath = join(tmpdir(), `clickbait-${id}.rpp`);
  const luaPath = join(tmpdir(), `clickbait-${id}.lua`);
  const donePath = join(tmpdir(), `clickbait-${id}.done`);

  writeFileSync(rppPath, rppContent);

  const wrapped = `
local CLICKBAIT_PROJECT = ${JSON.stringify(rppPath)}
${lua}
local f = io.open(${JSON.stringify(donePath)}, "w")
f:write("done")
f:close()
`;
  writeFileSync(luaPath, wrapped);
  if (existsSync(donePath)) unlinkSync(donePath);

  spawn(REAPER_BIN, [rppPath, luaPath], { detached: true, stdio: "ignore" });

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (existsSync(donePath)) return readFileSync(rppPath, "utf-8");
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  throw new Error(`REAPER script timed out after ${TIMEOUT_MS}ms`);
}

/** Parse marker lines from an RPP string. Positions are in seconds. */
export function parseMarkers(rpp: string): Array<{ id: number; pos: number; name: string; isEnd: boolean }> {
  return rpp
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("MARKER "))
    .map((l) => {
      // End marker: MARKER id pos "" color
      if (l.match(/^MARKER \d+ [\d.]+ ""/)) {
        const m = l.match(/^MARKER (\d+) ([\d.]+)/);
        if (m) return { id: +m[1], pos: +m[2], name: "", isEnd: true };
      }
      // Quoted name
      const q = l.match(/^MARKER (\d+) ([\d.]+) "([^"]+)"/);
      if (q) return { id: +q[1], pos: +q[2], name: q[3], isEnd: false };
      // Unquoted name (single word, stops before the color number)
      const u = l.match(/^MARKER (\d+) ([\d.]+) (\S+)/);
      if (u) return { id: +u[1], pos: +u[2], name: u[3], isEnd: false };
      return null;
    })
    .filter(Boolean) as Array<{ id: number; pos: number; name: string; isEnd: boolean }>;
}

/** Parse PT entries from an RPP string. Positions are in seconds. */
export function parsePTs(rpp: string): Array<{ pos: number; bpm: number; beatsPerBar: number }> {
  return rpp
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("PT "))
    .map((l) => {
      const parts = l.split(" ");
      return {
        pos: +parts[1],                   // seconds
        bpm: +parts[2],
        beatsPerBar: +parts[4] - 262144,  // timesigFlags = 262144 + beatsPerBar
      };
    });
}
