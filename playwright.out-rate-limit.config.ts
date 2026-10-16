import { defineConfig } from "@playwright/test";

import { E2E_SERVER_ENV } from "./playwright.config";

const PORT = Number(process.env.PW_PORT ?? 3103);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/out-rate-limit.spec.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: { baseURL: BASE_URL },
  webServer: {
    // Only these dynamic routes are needed. Compile mode omits type checking
    // and prerendering, which belong to the full build gate.
    command: `node scripts/run-with-restored-next-env.mjs node node_modules/next/dist/bin/next build --experimental-build-mode compile --debug-build-paths=app/out/page.tsx,app/api/out/route.ts && npm run start -- --hostname 127.0.0.1 --port ${PORT}`,
    env: {
      ...E2E_SERVER_ENV,
      NEXT_DIST_DIR: ".next-out-rate-limit",
      PUBMAX_E2E_RATE_LIMIT_MAX: "60",
      PUBMAX_E2E_KEYLESS: "1",
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      TICKETMASTER_API_KEY: "",
      SKIDDLE_API_KEY: "",
      OPENROUTER_API_KEY: "",
      VERCEL_ENV: "",
    },
    url: `${BASE_URL}/out`,
    reuseExistingServer: false,
    timeout: 600_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
