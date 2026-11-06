import { test, expect, type Request } from "@playwright/test";

import { pinLondonEvening } from "./helpers/planFirstPint";

// Captain decision, 3 Nov 2026: Plan keeps the Pub Pal's drafted pubs. "Open
// in Plan" used to carry only the ask, so Plan answered it with pubs of its
// own and the crawl the Pal drafted vanished between two screens.
//
// The Pal's answer is stubbed to the draft the keyless Pal gives for this ask
// (three walkable Clapham pubs, lib/palPlanDraft.ts). Everything after the tap
// is the real product: the session draft, the anchored generator on the
// production build, and the route the reader is shown.

const ASK = "Plan a crawl in Clapham for 4, not pricey";
const DRAFT = [
  { venueId: "venue-ywzy0i", name: "The Pheonix" },
  { venueId: "venue-l5qye7", name: "The Bread & Roses" },
  { venueId: "venue-e7wfn7", name: "The Coach & Horses" },
];

type DraftStop = { venueId: string; name: string };

async function stubPalDraft(page: import("@playwright/test").Page, draft: readonly DraftStop[]) {
  await page.route("**/api/pub-pal/chat", async (route) => {
    const body = {
      answer: `Proposed draft: ${draft.map((stop) => stop.name).join(" → ")}. Open in Plan to keep these pubs. Plan checks every stop, and nothing is saved until you do.`,
      cards: draft.map((stop, index) => ({
        key: stop.venueId,
        venueId: stop.venueId,
        title: stop.name,
        place: "Clapham",
        note: `Stop ${index + 1}: Listed pick`,
        provenance: { label: "On record", kind: "directory" },
      })),
      proposals: [{
        id: `plan:${draft.map((stop) => stop.venueId).join("-")}`,
        kind: "draft_plan",
        label: "Open in Plan",
        query: ASK,
        stopIds: draft.map((stop) => stop.venueId),
        stopNames: draft.map((stop) => stop.name),
      }],
      sources: [],
      status: "ready",
      toolsUsed: ["propose_plan"],
      conversationId: "conv_e2ekeepdraft1",
    };
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson; charset=utf-8",
      body: `${JSON.stringify({ type: "final", body })}\n`,
    });
  });
}

async function openDraftInPlan(page: import("@playwright/test").Page): Promise<Request[]> {
  const generations: Request[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/plans/generate") generations.push(request);
  });
  await page.goto("/pal/chat");
  await page.getByRole("textbox", { name: /Where, how many, what budget/i }).fill(ASK);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const open = page.getByRole("link", { name: "Open in Plan" });
  await expect(open).toBeVisible();
  await open.click();
  await expect(page).toHaveURL(/\/plan\?/);
  return generations;
}

test("Open in Plan keeps the pubs the Pal drafted, and says so", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pinLondonEvening(page);
  await stubPalDraft(page, DRAFT);
  const generations = await openDraftInPlan(page);

  const stops = page.locator(".planStop__surface");
  await expect(stops).toHaveCount(3, { timeout: 30_000 });
  for (const [index, stop] of DRAFT.entries()) {
    await expect(stops.nth(index)).toContainText(stop.name);
  }
  await expect(page.locator("#plan-route-status")).toContainText(
    "Kept your Pub Pal's pubs: The Pheonix, The Bread & Roses and The Coach & Horses.",
  );

  // The first generation asked to keep the whole draft, and it was enough.
  expect(generations.length).toBeGreaterThanOrEqual(1);
  const first = generations[0]!.postDataJSON() as { anchor?: { venueIds?: string[]; source?: string }; context?: { stopCount?: number } };
  expect(first.anchor?.source).toBe("pal");
  expect(first.anchor?.venueIds).toEqual(DRAFT.map((stop) => stop.venueId));
  expect(first.context?.stopCount).toBe(3);

  // The kept route locks in like any other: the grounding proof names the Pal.
  await page.getByRole("textbox", { name: /your name/i }).fill("Alex");
  await page.getByRole("button", { name: "Lock it in" }).first().click();
  await expect(page).toHaveURL(/\/plan\/[^/?#]+/, { timeout: 30_000 });
  await expect(page.getByText(`First up: ${DRAFT[0]!.name}`)).toBeVisible();
});

test("a draft Plan cannot walk says so, and never claims to have kept it", async ({ page }) => {
  // The Pal's old Clapham draft: The Pheonix is 2.8 km from the other two, so
  // Plan's walking rule refuses the whole crawl.
  await page.setViewportSize({ width: 390, height: 844 });
  await pinLondonEvening(page);
  await stubPalDraft(page, [
    { venueId: "venue-1fz0jhj", name: "The London and South Western" },
    { venueId: "venue-1ros0mx", name: "Junction (Clapham)" },
    { venueId: "venue-ywzy0i", name: "The Pheonix" },
  ]);
  const generations = await openDraftInPlan(page);
  const status = page.locator("#plan-route-status");
  await expect(status).toContainText(/Your Pub Pal's pubs could not (all make one|make a) route Plan can vouch for/, { timeout: 30_000 });
  await expect(status).not.toContainText("Kept your Pub Pal's pubs");
  const first = generations[0]!.postDataJSON() as { anchor?: { venueIds?: string[] } };
  expect(first.anchor?.venueIds).toEqual(["venue-1fz0jhj", "venue-1ros0mx", "venue-ywzy0i"]);
  expect(generations.length).toBeGreaterThanOrEqual(2);
});

test("a /plan visit after the handoff does not reuse the draft", async ({ page }) => {
  await page.goto("/plan");
  await page.evaluate((draft) => sessionStorage.setItem("pubmax:ask-plan-draft:v1", JSON.stringify(draft)), {
    query: "Plan a crawl in Clapham for 4, not pricey",
    stopIds: DRAFT.map((stop) => stop.venueId),
    stopNames: DRAFT.map((stop) => stop.name),
    createdAt: new Date().toISOString(),
    origin: "pal",
  });
  // A different ask in the address is not the draft's ask: Plan plans it as
  // it always did, and spends the stale draft rather than keeping it about.
  const generations: Request[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/plans/generate") generations.push(request);
  });
  await page.goto(`/plan?query=${encodeURIComponent("Three pubs in Victoria for 4")}`);
  await expect.poll(() => generations.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  const sent = generations[0]!.postDataJSON() as { anchor?: unknown };
  expect(sent.anchor).toBeUndefined();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("pubmax:ask-plan-draft:v1"))).toBeNull();
});
