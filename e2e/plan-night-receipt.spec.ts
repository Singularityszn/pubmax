import { isNonPublicVenueName } from "@/lib/venueKindFilters";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

// The private Night Receipt belongs to the account bound to a completed Plan's
// host seat. The host capability cookie alone proves no account, so a
// signed-out reader who holds it sees none, and the receipt read refuses that
// cookie. A guest and a reader with no capability see none either. Each
// capability reaches the browser the way a real member's does: the token seeded
// below is exchanged for the HttpOnly session by restorePlanCapability on mount.
// The keyless server has no account verification, so the signed-in owner path
// is proved in __tests__/nightReceipt.test.ts and planNightReceipt.test.tsx.

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

test("a host capability cookie without its bound account shows no Night Receipt", async ({ browser, playwright, baseURL }) => {
  const host = await playwright.request.newContext({ baseURL });
  const guest = await playwright.request.newContext({ baseURL });
  const { planId, hostToken, guestToken } = await completedPlanWithGuest(host, guest);

  const hostContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const hostPage = await hostContext.newPage();
  await openPlan(hostPage, planId, hostToken);
  await expect(hostPage.getByRole("heading", { name: /Who.s in/ })).toBeVisible();
  await expect(hostPage.getByRole("region", { name: "Your night receipt" })).toHaveCount(0);
  const receiptRead = await hostPage.request.get(`/api/plans/${planId}?view=receipt`);
  expect(receiptRead.status()).toBe(403);
  expect(await receiptRead.text()).not.toContain("Receipt night");

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
