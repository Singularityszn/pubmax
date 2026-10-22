import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

const servers = Array.isArray(base.webServer) ? base.webServer : [base.webServer];
export default defineConfig({
  ...base,
  projects: base.projects?.filter((project) => project.name === "chromium-keyless"),
  webServer: servers.filter((server) => server?.url === "http://localhost:55352"),
});
