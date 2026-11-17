import { isNonPublicVenueName } from "@/lib/venueKindFilters";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

// The private Night Receipt belongs to the host of a completed Plan. A guest
// member reads the same full Plan and still sees none, and a reader with no
// capability sees only the preview. Each capability reaches the browser the way
// a real member's does: the token seeded below is exchanged for the HttpOnly
// session by restorePlanCapability on mount.

const GUEST_NAME = "Guest mate";

async function completedPlanWithGuest(host: APIRequestContext, guest: APIRequestContext) {
  const venueResponse = await host.get("/data/venues_slim.json");
  const venues = ((await venueResponse.json() as { rows: Array<{ id: string; name: string }> }).rows)
    .filter((venue) => !isNonPublicVenueName(venue.name)).slice(0, 3);
  const created = await (await host.post("/api/plans", {
    headers: { "idempotency-key": randomUUID() },
    data: {
      title: "Receipt night",
      creatorName: "Receipt host",
      startTime: new Date().toISOString(),
      stops: venues.map((venue) => ({ venueId: venue.id, venueName: venue.name })),
    },
  })).json() as { plan: { plan: { id: string } }; memberToken: string };
  const planId = created.plan.plan.id;
  const hostToken = created.memberToken;
  const hostRead = await (await host.get(`/api/plans/${planId}`, {
    headers: { authorization: `Bearer ${hostToken}` },
  })).json() as { inviteToken: string };
  const joined = await guest.post(`/api/plans/${planId}/join`, {
    headers: { "idempotency-key": randomUUID() },
    data: { name: GUEST_NAME, inviteToken: hostRead.inviteToken },
  });
  expect(joined.ok()).toBe(true);
  const guestToken = (await joined.json() as { memberToken: string }).memberToken;
  expect((await host.post(`/api/plans/${planId}/actions`, {
    headers: { "idempotency-key": randomUUID() },
    data: { memberToken: hostToken, type: "arrived", stopPosition: 0 },
  })).ok()).toBe(true);
  expect((await host.post(`/api/plans/${planId}/complete`, {
    data: {
      memberToken: hostToken,
      expectedRouteRevision: 1,
      ending: "get_home",
      endingSelection: {
        kind: "get_home",
        optionId: "transport:nearest-station",
        evidenceSnapshot: { label: "Nearest station", confidence: "unknown" },
      },
    },
  })).ok()).toBe(true);
  return { planId, hostToken, guestToken };
}

async function openPlan(page: Page, planId: string, token: string | null): Promise<void> {
  await page.addInitScript(({ id, tok }) => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    if (tok) window.sessionStorage.setItem(`pubmax-plan-member:${id}`, tok);
  }, { id: planId, tok: token });
  const read = page.waitForResponse(async (response) => {
    if (!response.url().endsWith(`/api/plans/${planId}`) || response.request().method() !== "GET") return false;
    const body = await response.json().catch(() => null) as { stops?: unknown; visibility?: unknown } | null;
    return token ? Array.isArray(body?.stops) : body?.visibility === "preview";
  });
  await page.goto(`/plan/${planId}`);
  await read;
}

test("only the host of a completed Plan sees the private Night Receipt", async ({ browser, playwright, baseURL }) => {
  const host = await playwright.request.newContext({ baseURL });
  const guest = await playwright.request.newContext({ baseURL });
  const { planId, hostToken, guestToken } = await completedPlanWithGuest(host, guest);

  const hostContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const hostPage = await hostContext.newPage();
  await openPlan(hostPage, planId, hostToken);
  const receipt = hostPage.getByRole("region", { name: "Your night receipt" });
  await expect(receipt).toBeVisible();
  await expect(receipt.getByRole("definition")).toContainText(["Not recorded", "Heading home"]);
  await expect(receipt).not.toContainText(GUEST_NAME);
  expect(await hostPage.evaluate(() => document.documentElement.scrollWidth)).toBe(390);

  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  await openPlan(guestPage, planId, guestToken);
  await expect(guestPage.getByRole("heading", { name: /Who.s in/ })).toBeVisible();
  await expect(guestPage.getByText(GUEST_NAME).first()).toBeVisible();
  await expect(guestPage.getByRole("region", { name: "Your night receipt" })).toHaveCount(0);

  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  await openPlan(publicPage, planId, null);
  await expect(publicPage.getByRole("region", { name: "Your night receipt" })).toHaveCount(0);
  expect(await (await host.get(`/plan/${planId}`)).text()).not.toContain("Receipt night");

  await Promise.all([hostContext.close(), guestContext.close(), publicContext.close(), host.dispose(), guest.dispose()]);
});
