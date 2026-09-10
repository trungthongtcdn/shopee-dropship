import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 15000,
    // Multiple test files share one real Postgres DB and mutate the same
    // tables (order, syncLog, ...) via beforeEach deleteMany. Running files
    // in parallel (Vitest's default) races those mutations against each
    // other. Force sequential file execution to keep the suite deterministic.
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
