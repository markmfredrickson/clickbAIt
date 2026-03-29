import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "teleprompter.spec.ts",
  timeout: 120_000,
  use: {
    baseURL: "http://localhost:3000",
    viewport: { width: 1280, height: 720 },
    video: {
      mode: "on",
      size: { width: 1280, height: 720 },
    },
    // Slow down interactions so they're visible in the recording
    launchOptions: {
      slowMo: 100,
    },
  },
  projects: [
    {
      name: "screencast",
      use: { browserName: "chromium" },
    },
  ],
  outputDir: "./output",
});
