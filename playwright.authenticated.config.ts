import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Reuse the real authentication project and server. The keyless server is
// unrelated to this proof and must not replace genuine server verification.
const authenticated = base.projects?.find((project) => project.name === "chromium-authenticated");
const servers = Array.isArray(base.webServer) ? base.webServer : [base.webServer];
const authServer = servers.find((server) => server?.env?.PUBMAX_E2E_LOGIN === "1");
if (!authenticated || !authServer) {
  throw new Error("The real authenticated profile and production server are required.");
}

export default defineConfig({
  ...base,
  projects: [authenticated],
  webServer: authServer,
  workers: 1,
  retries: 0,
  use: { ...base.use, trace: "on" },
});
