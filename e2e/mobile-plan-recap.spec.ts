import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

test("completed Plan recap stays usable across mobile widths and explicit discard survives remount", async ({ page, request }) => {
  test.setTimeout(60_000);
  const startTime = new Date().toISOString();
  const venueResponse = await request.get("/data/venues_slim.json");
  const venues = (await venueResponse.json() as Array<{ id: string; name: string }>).slice(0, 3);
  expect(venues).toHaveLength(3);
  const createdResponse = await request.post("/api/plans", {
    headers: { "idempotency-key": randomUUID() },
    data: {
      title: "Thursday orbit",
      creatorName: "Mobile host",
      startTime,
      stops: venues.map((venue) => ({ venueId: venue.id, venueName: venue.name })),
    },
  });
  expect(createdResponse.ok()).toBe(true);
  const created = await createdResponse.json() as { plan: { plan: { id: string } }; memberToken: string };
  const planId = created.plan.plan.id;
  const arrivalResponse = await request.post(`/api/plans/${planId}/actions`, {
    headers: { "idempotency-key": randomUUID() },
    data: {
      memberToken: created.memberToken,
      type: "arrived",
      stopPosition: 0,
    },
  });
  expect(arrivalResponse.ok()).toBe(true);
  const completionResponse = await request.post(`/api/plans/${planId}/complete`, {
    data: {
      memberToken: created.memberToken,
      expectedRouteRevision: 1,
      ending: "get_home",
      endingSelection: {
        kind: "get_home",
        optionId: "transport:nearest-station",
        evidenceSnapshot: { label: "Nearest station", confidence: "unknown" },
      },
    },
  });
  expect(completionResponse.ok()).toBe(true);

  await page.addInitScript(({ id, start, token }) => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax:e2e-defer-shell:v1", "now");
    window.localStorage.setItem("pubmax_active_plan", JSON.stringify({ id, startTime: start, stopIndex: 2 }));
    window.sessionStorage.setItem(`pubmax-plan-member:${id}`, token);
  }, { id: planId, start: startTime, token: created.memberToken });

  const viewports = [
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 320, height: 568 },
  ];
  for (const [index, viewport] of viewports.entries()) {
    await page.setViewportSize(viewport);
    await page.goto("/tonight");
    const nightPill = page.getByRole("button", { name: "Show tonight's plan" });
    const createAction = page.locator(".createFab");
    await expect(nightPill).toBeVisible();
    await expect(createAction).toBeVisible();

    const [nightBox, createBox] = await Promise.all([
      nightPill.boundingBox(),
      createAction.boundingBox(),
    ]);
    expect(nightBox).not.toBeNull();
    expect(createBox).not.toBeNull();
    const stackGap = await page.evaluate(() => Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--float-stack-gap"),
    ));
    expect(stackGap).toBe(12);
    expect(nightBox!.y - (createBox!.y + createBox!.height)).toBeGreaterThanOrEqual(stackGap);
    expect(await nightPill.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return document.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2,
      )?.closest(".nightPill") === element;
    })).toBe(true);
    expect(await createAction.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return document.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2,
      )?.closest(".createFab") === element;
    })).toBe(true);

    await nightPill.click();
    await expect(page.getByRole("dialog", { name: "Tonight's plan" })).toBeVisible();
    if (index < viewports.length - 1) {
      await page.keyboard.press("Escape");
      await expect(nightPill).toBeFocused();
    }
  }

  const sheet = page.getByRole("dialog", { name: "Tonight's plan" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Review private recap" }).click();
  await expect(sheet.getByText("Private recap preview")).toBeVisible();
  const box = await sheet.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(568);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  if (process.env.PUBMAX_GATE_Z_SHOTS) {
    const directory = "docs/screenshots/the-local-gate-z";
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: `${directory}/private-recap-320x568-light.png` });
  }

  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show tonight's plan" })).toBeFocused();

  await page.getByRole("button", { name: "Show tonight's plan" }).click();
  await page.getByRole("dialog", { name: "Tonight's plan" }).getByRole("button", { name: "Discard local recap" }).click();
  await page.goto("/tonight");
  await page.getByRole("button", { name: "Show tonight's plan" }).click();
  await expect(page.getByRole("button", { name: "Review private recap" })).toHaveCount(0);
});
