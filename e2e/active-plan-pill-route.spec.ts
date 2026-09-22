import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

import { expect, test } from "@playwright/test";

type PlanCreateResponse = {
  memberToken: string;
  plan: { plan: { id: string } };
};

test("active-plan pill resolves its route after a late capability exchange", async ({
  page,
  request,
}) => {
  const startTime = new Date(Date.now() + 30 * 60 * 1_000).toISOString();
  const venueResponse = await request.get("/data/venues_slim.json");
  const venues = (
    (await venueResponse.json()) as {
      rows: Array<{ id: string; name: string }>;
    }
  ).rows.slice(0, 3);
  expect(venues).toHaveLength(3);

  const createdResponse = await request.post("/api/plans", {
    headers: { "idempotency-key": randomUUID() },
    data: {
      title: "Active-plan route recovery",
      creatorName: "Mobile host",
      startTime,
      stops: venues.map((venue) => ({
        venueId: venue.id,
        venueName: venue.name,
      })),
    },
  });
  expect(createdResponse.status()).toBe(201);
  const created = (await createdResponse.json()) as PlanCreateResponse;
  const planId = created.plan.plan.id;

  for (const status of ["ready", "active"] as const) {
    const response = await request.patch(`/api/plans/${planId}`, {
      data: { memberToken: created.memberToken, status },
    });
    expect(response.ok()).toBe(true);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });

  let sessionExchanges = 0;
  await page.route(`**/api/plans/${planId}/session`, async (route) => {
    sessionExchanges += 1;
    // Force the real ordering behind #1537: the card's first Plan read returns
    // the privacy-safe preview before the stored member token becomes a cookie.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await route.continue();
  });
  await page.addInitScript(
    ({ id, start, token }) => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmax:e2e-defer-shell:v1", "now");
      window.localStorage.setItem(
        "pubmax_active_plan",
        JSON.stringify({
          version: 1,
          id,
          startTime: start,
          stopIndex: 0,
        }),
      );
      window.sessionStorage.setItem(`pubmax-plan-member:${id}`, token);
    },
    { id: planId, start: startTime, token: created.memberToken },
  );

  await page.goto("/tonight");
  const pill = page.getByRole("button", { name: "Show tonight's plan" });
  const sheet = page.getByRole("dialog", { name: "Tonight's plan" });
  await expect(async () => {
    await pill.click();
    await expect(sheet).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  await expect(page.locator(".createFabRoot")).toBeHidden();

  const loading = sheet.locator(".nightCard__loading");
  await expect(loading).toBeVisible();
  await expect(sheet.getByText(venues[0].name, { exact: true })).toBeVisible();
  await expect(loading).toHaveCount(0);
  expect(sessionExchanges).toBe(1);

  if (process.env.PUBMAX_ISSUE_1537_SHOT) {
    const directory = "docs/proof/active-plan-route";
    await mkdir(directory, { recursive: true });
    await page.screenshot({
      path: `${directory}/after-390x844-dark.png`,
      fullPage: false,
    });
  }
});
