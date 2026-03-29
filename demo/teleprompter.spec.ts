/**
 * clickbAIt Teleprompter — Playwright screencast
 *
 * Records a video of the teleprompter UI in action:
 * 1. Starts the demo server (simulated REAPER playback)
 * 2. Opens the browser and waits for song to load
 * 3. Watches lyrics scroll and highlight for a few sections
 * 4. Demonstrates UI controls (dark mode, text size, offset)
 * 5. Saves the recording to demo/output/
 *
 * Run: npx playwright test --config demo/playwright.config.ts
 */

import { test, expect, type Page } from "@playwright/test";
import { type ChildProcess, spawn } from "node:child_process";
import { resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const DEMO_SCRIPT = resolve(PROJECT_ROOT, "scripts/teleprompter-demo.ts");

let demoServer: ChildProcess;

test.beforeAll(async () => {
  // Start the demo server (teleprompter + simulated OSC beats)
  demoServer = spawn("npx", ["tsx", DEMO_SCRIPT], {
    cwd: PROJECT_ROOT,
    stdio: "pipe",
  });

  // Wait for server to be ready
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Demo server startup timeout")), 15_000);
    demoServer.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      if (text.includes("Simulating REAPER playback")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    demoServer.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
});

test.afterAll(async () => {
  demoServer?.kill("SIGTERM");
  // Give it a moment to clean up
  await new Promise((r) => setTimeout(r, 500));
});

test("teleprompter screencast", async ({ page }) => {
  // ── Load the teleprompter ──
  await page.goto("/lyrics");
  await expect(page.locator("#song-title")).not.toBeEmpty({ timeout: 10_000 });

  // Verify song loaded
  await expect(page.locator("#song-title")).toContainText("When the Saints");

  // Let it play for a bit — watch lyrics highlight and scroll
  await waitBeats(page, 4_000, "Watching intro...");

  // ── Demo: toggle dark mode ──
  await page.click("#dark-mode-btn");
  await waitBeats(page, 3_000, "Light mode");

  await page.click("#dark-mode-btn");
  await waitBeats(page, 2_000, "Back to dark mode");

  // ── Demo: adjust text size ──
  await dragSlider(page, "#size-slider", 3.0);
  await waitBeats(page, 3_000, "Larger text");

  await dragSlider(page, "#size-slider", 1.5);
  await waitBeats(page, 2_000, "Normal text");

  // ── Demo: adjust offset (look-ahead) ──
  await dragSlider(page, "#offset-slider", 8);
  await waitBeats(page, 4_000, "Look-ahead offset");

  await dragSlider(page, "#offset-slider", 2);
  await waitBeats(page, 2_000, "Moderate offset");

  // ── Let it play through more sections ──
  await waitBeats(page, 15_000, "Watching verse/chorus transitions...");

  // ── Demo: toggle auto-scroll off and back on ──
  await page.click("#scroll-mode-btn");
  await waitBeats(page, 3_000, "Manual scroll mode");

  // Scroll up manually to show it doesn't auto-follow
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await waitBeats(page, 2_000, "Scrolled to top manually");

  await page.click("#scroll-mode-btn");
  await waitBeats(page, 4_000, "Auto-scroll re-engaged");

  // ── Final stretch — let it play out ──
  await waitBeats(page, 10_000, "Final section playback");
});

// ── Helpers ──

/** Wait for a duration while beats continue playing */
async function waitBeats(page: Page, ms: number, _label: string) {
  await page.waitForTimeout(ms);
}

/** Drag a range slider to a specific value */
async function dragSlider(page: Page, selector: string, value: number) {
  await page.evaluate(
    ({ sel, val }) => {
      const slider = document.querySelector(sel) as HTMLInputElement;
      if (!slider) return;
      slider.value = String(val);
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { sel: selector, val: value },
  );
}
