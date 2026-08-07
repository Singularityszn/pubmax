import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

// Task: plan-invite-page. Proves the whole public invite feature end to end on
// the production build: a real Plan's member-only invite token (exposed via
// GET /api/plans/[id]'s member branch), the public /invite/[token] render, and
// a genuine handle-free RSVP write driven through the rendered UI - not a bare
// API call - so the client island and the server route are both proven live.

const PLAN_TITLE = "Karan invite spec crawl";
const HOST_NAME = "Karan";

test("public invite page renders a Plan and accepts a handle-free RSVP", async ({ request, page }) => {
  const venues = (await (await request.get("/data/venues_slim.json")).json() as Array<{
    id: string;
    name: string;
    cheapestPrice: number | null;
  }>).slice(0, 3);
  expect(venues.length).toBe(3);

  const created = await request.post("/api/plans", {
    headers: { "idempotency-key": randomUUID() },
    data: {
      title: PLAN_TITLE,
      startTime: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
      creatorName: HOST_NAME,
      stops: venues.map((v) => ({ venueId: v.id, venueName: v.name })),
    },
  });
  expect(created.ok()).toBe(true);
  const id: string = (await created.json()).plan.plan.id;

  // The creating request context keeps the HttpOnly plan-member-session
  // cookie, so this read comes back on the "member" branch of
  // resolvePlanProjection and carries the real inviteToken.
  const state = await (await request.get(`/api/plans/${id}`)).json() as { inviteToken?: string | null };
  expect(state.inviteToken).toBeTruthy();
  const token = state.inviteToken as string;

  // The public page itself: a genuinely anonymous browser context, no member
  // cookie, exactly like an uninvited link recipient.
  await page.goto(`/invite/${token}`);
  await expect(page.locator(".invite__title")).toHaveText(PLAN_TITLE);
  await expect(page.locator(".invite__eyebrow")).toContainText(HOST_NAME);
  await expect(page.locator(".invite__stop")).toHaveCount(3);
  for (const venue of venues) {
    await expect(page.locator(".invite__stop", { hasText: venue.name })).toBeVisible();
  }
  // Honesty check: formatPrice(null) returns the literal string "No price",
  // which must never render as if it were a real figure.
  await expect(page.locator(".invite")).not.toContainText("No price");

  // No RSVPs yet - the honest empty state, not a fake number.
  await expect(page.locator(".inviteRsvp__empty")).toHaveText("No RSVPs yet. Be the first.");
  await expect(page.locator(".inviteRsvp__count").first()).toHaveText("0");

  // Drive the actual RSVP write through the rendered client island.
  const guestName = "Priya";
  await page.locator(".inviteRsvp__nameInput").fill(guestName);
  await page.getByRole("button", { name: "Going", exact: true }).click();
  await page.getByRole("button", { name: "RSVP", exact: true }).click();

  const guestRow = page.locator(".inviteRsvp__guest", { hasText: guestName });
  await expect(guestRow).toBeVisible();
  await expect(guestRow.locator(".inviteRsvp__guestStatus")).toHaveText("Going");
  await expect(page.locator(".inviteRsvp__count").first()).toHaveText("1");
  await expect(page.locator(".inviteRsvp__empty")).toHaveCount(0);

  // Reload proves the write actually persisted server-side, not just local state.
  await page.reload();
  await expect(page.locator(".inviteRsvp__guest", { hasText: guestName })).toBeVisible();
  await expect(page.locator(".inviteRsvp__count").first()).toHaveText("1");

  // Emoji reaction round-trip too.
  await page.getByRole("button", { name: "Cheers" }).click();
  await expect(page.getByRole("button", { name: "Cheers" })).toHaveAttribute("aria-pressed", "true");
});

test("an unknown invite token renders the honest not-found state", async ({ page }) => {
  await page.goto("/invite/000000000000000000000000000000ff");
  await expect(page.locator(".invite__emptyTitle")).toHaveText("This invite link isn’t valid");
});
