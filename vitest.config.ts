import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setupGlobals.ts", "./tests/setupTests.ts"],
    globals: true,
    // Ten jsdom workers saturate this project's React-heavy suites and make
    // otherwise 1-3 second tests miss the 10 second safety timeout.
    minWorkers: 1,
    maxWorkers: 4,
    coverage: {
      reporter: ["text", "lcov"],
    },
  },
});
