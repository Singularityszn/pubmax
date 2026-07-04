import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

// Node environment: we test pure functions (venues, curation) and the API route
// handler by calling it directly — no DOM needed. "@/..." resolves to repo root,
// matching tsconfig paths.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
  },
});
