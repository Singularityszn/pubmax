import { chromium, defineConfig } from "@playwright/test";
import base from "../../playwright.config";

const desktop = base.projects?.find((project) => project.name === "chromium");
if (!desktop) throw new Error("Existing Chromium project missing.");

export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "friend-location-browser.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  projects: [{
    ...desktop,
    name: "friends-headed-proof",
    testMatch: "friend-location-browser.spec.ts",
    testIgnore: [],
    use: {
      ...desktop.use,
      headless: false,
      serviceWorkers: "block",
      trace: "off",
      video: "off",
      launchOptions: {
        ...desktop.use?.launchOptions,
        executablePath: chromium.executablePath(),
      },
    },
  }],
});
