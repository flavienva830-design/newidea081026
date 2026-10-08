import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", testTimeout: 30000, coverage: { provider: "v8", include: ["src/**"], exclude: ["src/index.ts", "src/types.ts"], thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 } } },
});
