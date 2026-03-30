import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      // AI-generated songs may still use relative paths — map them to the package
      "@clickbait/dsongl": path.resolve("packages/dsongl/src/index.ts"),
      "../../src/dsongl.js": path.resolve("packages/dsongl/src/index.ts"),
      "../../../../../src/dsongl.js": path.resolve("packages/dsongl/src/index.ts"),
      "../../../../src/dsongl.js": path.resolve("packages/dsongl/src/index.ts"),
      "../../../../../../src/dsongl.js": path.resolve("packages/dsongl/src/index.ts"),
      "../../../../../../src/types.js": path.resolve("packages/dsongl/src/index.ts"),
    },
  },
});
