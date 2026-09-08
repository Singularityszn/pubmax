import { test } from "./helpers/planFixtureCaller";
import { randomUUID } from "node:crypto";

import { expect } from "@playwright/test";

type PlanCreateResponse = {
  memberToken: string;
  plan: {
    plan: { id: string; startTime: string };
  };
};

const MOBILE_VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

test("an active Plan starts a Round with its ordered stops", async ({ page, planFixtureHeaders }) => {
  const stops = [
    { venueId: "venue-xjf3n0", venueName: "Arnos Arms" },
    { venueId: "venue-1f5ygjb", venueName: "The Bohemia" },
    { venueId: "venue-3h52h", venueName: "The Elephant Inn" },
  ];
  const discardedStops = stops.slice().reverse();
  const startTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const handle = `bridge_${Date.now().toString(36)}`;
  const api = page.context().request;
  const created = await api.post("/api/plans", {
    headers: { ...planFixtureHeaders, "idempotency-key": randomUUID() },
    data: {
      title: "Active Plan bridge",
      startTime,
      creatorName: "Bridge host",
      stops,
    },
  });
  expect(created.status()).toBe(201);
  const body = (await created.json()) as PlanCreateResponse;
  const planId = body.plan.plan.id;

  const ready = await api.patch(`/api/plans/${planId}`, {
    data: {
      memberToken: body.memberToken,
      status: "ready",
      context: {
        nightArea: "clapham",
        daypart: "evening",
        partyType: "friends",
        groupSize: 3,
        budget: "value",
      },
    },
  });
  expect(ready.ok()).toBeTruthy();
  const active = await api.patch(`/api/plans/${planId}`, {
    data: { memberToken: body.memberToken, status: "active" },
  });
  expect(active.ok()).toBeTruthy();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/plans/generate", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ stops: discardedStops, alternatives: [] }),
    });
  });
  await page.addInitScript(
    ({ id, startsAt }) => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.localStorage.setItem(
        "pubmax_active_plan",
        JSON.stringify({ version: 1, id, startTime: startsAt, stopIndex: 0 }),
      );
    },
    { id: planId, startsAt: startTime },
  );

  await page.goto(`/plan/${planId}`);
  const nightMode = page.getByRole("dialog", { name: "Night mode" });
  await expect(nightMode).toBeVisible();
  await nightMode.getByRole("button", { name: "View full plan" }).click();

  const route = page.getByRole("region", { name: "The route" });
  await expect(route).toBeVisible();
  for (const stop of stops) {
    await expect(route.getByText(stop.venueName, { exact: true })).toBeVisible();
  }

  // The editor opens on the STORED stops in their stored order; the
  // generator's answer only supplies the backups (D02, 5 Sep 2026).
  await page.getByRole("button", { name: "Edit route" }).click();
  await expect(page.locator(".planSummary__editStops strong")).toHaveText(
    stops.map((stop) => stop.venueName),
  );
  await page.getByRole("button", { name: "Discard draft" }).click();

  const startRound = page.getByRole("button", { name: "Start Round", exact: true });
  await expect(startRound).toBeEnabled();
  for (const viewport of MOBILE_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.locator(".roundStarterRow").evaluate((row) => {
      row.scrollIntoView({ block: "center" });
    });
    const geometry = await page.locator(".planSummary").evaluate((summary) => {
      const starter = summary.querySelector<HTMLElement>(".roundStarter");
      const stops = summary.querySelectorAll<HTMLElement>(".planSummary__stops > li");
      const input = summary.querySelector<HTMLInputElement>(".roundStarterRow input");
      const action = summary.querySelector<HTMLButtonElement>(".roundStarterRow button");
      if (!starter || stops.length !== 3 || !input || !action) {
        throw new Error("Plan RoundStarter geometry is incomplete");
      }

      const starterRect = starter.getBoundingClientRect();
      const railRects = Array.from(stops, (stop) => {
        const rect = stop.getBoundingClientRect();
        const style = getComputedStyle(stop, "::before");
        const left = Number.parseFloat(style.left);
        const top = Number.parseFloat(style.top);
        const width = Number.parseFloat(style.width);
        const height = Number.parseFloat(style.height);
        if (style.content === "none" || ![left, top, width, height].every(Number.isFinite)
          || width <= 0 || height <= 0) {
          throw new Error("Plan route rail has no painted geometry");
        }
        return new DOMRect(rect.left + left, rect.top + top, width, height);
      });
      const actionRect = action.getBoundingClientRect();
      const overlaps = (first: DOMRect, second: DOMRect) =>
        first.left < second.right &&
        first.right > second.left &&
        first.top < second.bottom &&
        first.bottom > second.top;

      return {
        starterRailOverlap: railRects.some((rail) => overlaps(starterRect, rail)),
        actionRailOverlap: railRects.some((rail) => overlaps(actionRect, rail)),
      };
    });

    expect
      .soft(
        geometry.starterRailOverlap,
        `RoundStarter must clear route rail at ${viewport.width}px`,
      )
      .toBe(false);
    expect
      .soft(
        geometry.actionRailOverlap,
        `Start Round action must clear route rail at ${viewport.width}px`,
      )
      .toBe(false);
    await page.getByLabel("Your handle").click({ trial: true });
    await startRound.click({ trial: true });
  }
  await page.getByLabel("Your handle").fill(handle);
  // A lone click is not a wait for hydration: on a cold server the tap
  // landed before React attached and the page stayed on the plan for the
  // whole assertion budget. Retry the tap until the Round answers.
  await expect(async () => {
    await startRound.click();
    await expect(page).toHaveURL(/\/rounds\/[A-Z0-9]{6}$/, { timeout: 3_000 });
  }).toPass({ timeout: 20_000 });

  await expect(
    page.getByRole("heading", { name: "Active Plan bridge", exact: true }),
  ).toBeVisible();
  const roundRoute = page.getByRole("region", { name: "The Round's route" });
  await expect(roundRoute).toBeVisible();
  await expect(roundRoute.locator(".roundStopBody > strong")).toHaveText(
    stops.map((stop) => stop.venueName),
  );
});
