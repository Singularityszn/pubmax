import { test, expect } from "@playwright/test";

// DAG L16. The acceptance handoff used to sit behind PUBMAX_PAL_HANDOFF, which
// no deployment ever set, so the "Use this pub" affordance and the locality
// line were dark. The flag is retired and the handoff is the only behaviour.
//
// The handoff link and copy are pinned in __tests__/palChatAccept.test.ts. This
// spec owns that the page mounts and carries the handoff build's own chrome, and,
// against a stubbed `/api/pub-pal/chat` card answer, where the action sits.

test("Pal chat mounts and carries the handoff way back", async ({ page }) => {
  const response = await page.goto("/pal/chat");
  expect(response?.status()).toBe(200);
  // The ask surface renders.
  await expect(page.getByRole("textbox").first()).toBeVisible();
  // The secondary way onward is the handoff build's, not the retired flag-off copy.
  await expect(page.getByRole("link", { name: "Back to your Pub Pal" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Plan with the Pal" })).toHaveCount(0);
});

test("Use this pub sits inside the card on the body's inset with a 44px target", async ({ page }) => {
  // F19: the action sat flush against the card's left and bottom edge.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/pub-pal/chat", async (route) => {
    const body = {
      answer: "The cheapest listed pint near Soho is at The Queen's Head for 5.20.",
      cards: [
        {
          key: "queens-head",
          venueId: "venue-122cuu1",
          title: "The Queen's Head",
          place: "Westminster",
          note: "£5.20 is within budget",
          price: 5.2,
          provenance: { label: "On record", kind: "directory" },
        },
      ],
      proposals: [],
      sources: [],
      status: "ready",
      toolsUsed: ["search_venues"],
      conversationId: "conv_e2eaccept01",
    };
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson; charset=utf-8",
      body: `${JSON.stringify({ type: "final", body })}\n`,
    });
  });

  await page.goto("/pal/chat");
  await page.getByRole("textbox", { name: /Describe the outing/i }).fill("cheap pint near Soho");
  await page.getByRole("button", { name: "Ask" }).click();

  const card = page.locator(".palChatCard").first();
  const accept = card.getByRole("link", { name: "Use this pub" });
  await expect(accept).toBeVisible();
  const cardBox = (await card.boundingBox())!;
  const acceptBox = (await accept.boundingBox())!;
  const titleBox = (await card.locator(".palChatCardTitle").boundingBox())!;

  expect(acceptBox.height).toBeGreaterThanOrEqual(44);
  expect(Math.abs(acceptBox.x - titleBox.x)).toBeLessThanOrEqual(1);
  expect(acceptBox.x - cardBox.x).toBeGreaterThanOrEqual(12);
  expect(cardBox.y + cardBox.height - (acceptBox.y + acceptBox.height)).toBeGreaterThanOrEqual(12);
  expect(acceptBox.x + acceptBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
});
