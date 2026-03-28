import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      // Eval outputs use various relative paths to dsongl/types — normalize them all
      "../../src/dsongl.js": path.resolve("src/dsongl.ts"),
      "../../../../../src/dsongl.js": path.resolve("src/dsongl.ts"),
      "../../../../src/dsongl.js": path.resolve("src/dsongl.ts"),
      "../../../../../../src/dsongl.js": path.resolve("src/dsongl.ts"),
      "../../../../../../src/types.js": path.resolve("src/types.ts"),
    },
  },
});
