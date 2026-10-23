import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

// A visitor with no crew session is a guest. The invite tools say so instead of
// asking them to "try again", the budget chip reads £6, and the join form
// answers an empty name instead of doing nothing.

test("a guest on a plan sees guest wording and clean copy", async ({ page, request }) => {
  const venues = ((await (await request.get("/data/venues_slim.json")).json()) as {
    rows: Array<{ id: string; name: string }>;
  }).rows.slice(0, 3);
  const created = await request.post("/api/plans", {
    headers: { "idempotency-key": randomUUID() },
    data: {
      title: "Guest framing",
      startTime: new Date(Date.now() + 3 * 3600_000).toISOString(),
      creatorName: "Karan",
      stops: venues.map((v) => ({ venueId: v.id, venueName: v.name })),
    },
  });
  const id: string = (await created.json()).plan.plan.id;
  const token = ((await (await request.get(`/api/plans/${id}`)).json()) as { inviteToken: string })
    .inviteToken;

  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await page.goto(`/plan/${id}`);
  await expect(page.getByText("You're a guest on this plan. Join the crew to use the invite tools.")).toBeVisible();
  await expect(page.getByText("Invite tools need a crew session")).toHaveCount(0);
  await expect(page.getByText("Sort My Night P1")).toHaveCount(0);
  // A guest holds no crew list, so the "Who's in" card paints no count disc.
  const crewHeading = page.locator(".planCrew__heading");
  await expect(crewHeading.getByRole("heading", { name: "Who’s in" })).toBeVisible();
  await expect(crewHeading.locator(":scope > span")).toHaveCount(0);

  await page.goto(`/plan/${id}#invite=${token}`);
  await page.getByRole("button", { name: /I.m in/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Add your name to join." })).toBeVisible();
  await expect(page.locator("#join-name")).toBeFocused();
});
