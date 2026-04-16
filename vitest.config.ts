import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@clickbait/dsongl": path.resolve("src/dsongl/index.ts"),
      // Legacy relative imports from old eval/workspace song files
      "../../src/dsongl.js": path.resolve("src/dsongl/index.ts"),
      "../../../../../src/dsongl.js": path.resolve("src/dsongl/index.ts"),
      "../../../../src/dsongl.js": path.resolve("src/dsongl/index.ts"),
      "../../../../../../src/dsongl.js": path.resolve("src/dsongl/index.ts"),
      "../../../../../../src/types.js": path.resolve("src/dsongl/index.ts"),
    },
  },
  test: {
    exclude: [
      "**/node_modules/**",
      "**/.claude/worktrees/**",
      "**/sandbox/**",
      "**/demo/**",
    ],
  },
});
