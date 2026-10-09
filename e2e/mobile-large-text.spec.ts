import { expect, test } from "@playwright/test";

import { NATIVE_FIRST_RUN_HANDOFF_KEY } from "@/lib/nativeFirstRun";

import { installNativeShell } from "./helpers/nativeShell";
import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

const CORE_ROUTES = [
  "/tonight", "/places", "/out", "/plan", "/u/qa_android",
  "/map", "/near", "/wall", "/pal/chat", "/moment",
] as const;

test.use({
  serviceWorkers: "block", isMobile: true, hasTouch: true,
  launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
});
test.setTimeout(90_000);
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v2-done", "1");
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    sessionStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
  });
});

for (const scale of [1.3, 1.5, 2]) {
  test(`Android ${scale}x native text zoom keeps map figures inside their badges`, async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 840 });
    await installNativeShell(page, "android");
    await page.route("**/api/citymcp/status", (route) => route.fulfill({
      json: {
        signals: [{ headline: "Transport update", kind: "transport" }],
        // The map-edge badge counts only urgent tube lines (lib/mapChromeTiers.ts
        // isUrgentTubeStatus); routine updates stay in the sheet.
        tubeLines: [{ line: "Weaver", status: "Part Suspended" }],
