import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": r("./src"),
      "server-only": r("./test/stubs/server-only.ts"),
    },
  },
  test: { environment: "node", testTimeout: 30000, hookTimeout: 30000, fileParallelism: false, include: ["test/**/*.test.ts"] },
});
