import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

test("mobile Describe the outing builds one grounded route without camera flicker", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.removeItem("pubmax:plan-intake:v1");
    window.localStorage.removeItem("pubmaxx:plan-draft:v1");
    window.localStorage.removeItem("pubmaxx:plan-route-draft:v1");
    window.sessionStorage.removeItem("pubmax:plan-draft:v1");
    window.sessionStorage.removeItem("pubmaxx:plan-draft:v1");
    (window as Window & { __cameraIntents?: Array<{ kind: string; sequence: number }> }).__cameraIntents = [];
    window.addEventListener("pubmax:camera-intent", (event) => {
      const detail = (event as CustomEvent<{ kind: string; sequence: number }>).detail;
      (window as Window & { __cameraIntents?: Array<{ kind: string; sequence: number }> }).__cameraIntents?.push(detail);
    });
  });

  await page.goto("/map");
  await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Describe the outing" }).click();
  const planner = page.locator(".mapDrawer.left");
  await expect(planner).toHaveClass(/sheet-half/);
  await planner.getByRole("textbox", { name: "Describe the outing" }).fill("Four of us in Barnes, under £24 each and quiet");
  const generateResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().endsWith("/api/plans/generate"),
  );
  await expect(async () => {
    await planner.getByRole("button", { name: "Make a plan" }).click();
    // A successful generate hands the route to the built crawl, which leads the
    // phone planner once stops exist (phonePlannerOrder). The inline confidence
    // card is not stable across that reorder, so hold the crawl itself.
    await expect(planner.locator(".routeList li")).toHaveCount(3, { timeout: 3_000 });
  }).toPass({ timeout: 60_000 });
  const generated = await generateResponse;
  expect(generated.ok(), await generated.text()).toBeTruthy();
  const submitted = generated.request().postDataJSON() as { context: Record<string, unknown> };
  expect(submitted.context).not.toHaveProperty("nightArea");
  expect(submitted.context).not.toHaveProperty("atmosphere");
  await expect(planner.getByRole("heading", { name: "Hand-built plan" })).toBeVisible();
  await expect(planner.locator(".routePaceTotal")).toContainText("min walk");

  const routeIntents = await page.evaluate(() => (
    (window as Window & { __cameraIntents?: Array<{ kind: string }> }).__cameraIntents ?? []
  ).filter((intent) => intent.kind === "route").length);
  // One intent hands the generated crawl to the map; a second may follow when
  // walking totals upgrade. The guard is against flicker, not a single fly.
  expect(routeIntents).toBeLessThanOrEqual(2);

  if (process.env.PUBMAX_GATE_Z_SHOTS) {
    const directory = "docs/screenshots/the-local-gate-z";
    await mkdir(directory, { recursive: true });
    await planner.getByRole("button", { name: "Expand sheet" }).click();
    await expect(planner).toHaveClass(/sheet-full/);
    await planner.locator(".mobilePlannerRouteTotal").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${directory}/activation-route-390x844-light.png` });
    const cameraIntents = await page.evaluate(() => (
      (window as Window & { __cameraIntents?: Array<{ kind: string; sequence: number }> }).__cameraIntents ?? []
    ));
    await writeFile(`${directory}/camera-intents.json`, `${JSON.stringify({ cameraIntents, routeIntents }, null, 2)}\n`);
  }
});
