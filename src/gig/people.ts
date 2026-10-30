/**
 * Finding people in a video: people.swift, Apple's Vision framework, so macOS
 * only for now. The tool is compiled on first use into node_modules/.cache, and
 * again whenever its source changes.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { PeopleSample } from "./follow.js";

const SOURCE = resolve(import.meta.dirname, "people.swift");

function tool(): string {
  const hash = createHash("sha256").update(readFileSync(SOURCE)).digest("hex").slice(0, 12);
  const dir = resolve(import.meta.dirname, "../../node_modules/.cache/clickbait");
  const bin = join(dir, `people-${hash}`);
  if (!existsSync(bin)) {
    if (process.platform !== "darwin") throw new Error("finding people needs macOS (Apple's Vision framework)");
    mkdirSync(dir, { recursive: true });
    execFileSync("swiftc", ["-O", SOURCE, "-o", bin], { stdio: ["ignore", "ignore", "inherit"] });
  }
  return bin;
}

/** The people found in `video` from `start` to `end`, `rate` times a second. */
export function findPeople(video: string, start: number, end: number, rate: number): PeopleSample[] {
  const out = execFileSync(tool(), [video, String(start), String(end), String(rate)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as PeopleSample);
}
