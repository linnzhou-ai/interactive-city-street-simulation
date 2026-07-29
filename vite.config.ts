import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  test: {
    testTimeout: 15_000,
  },
});
