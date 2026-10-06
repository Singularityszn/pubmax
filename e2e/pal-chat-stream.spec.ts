import { expect, test } from "@playwright/test";

// A typed Pub Pal answer that arrives as an NDJSON stream (lib/palChatStream.ts)
// lands as the same answer bubble and cards as the JSON body. The route is
// stubbed, because the real stream needs the ElevenLabs agent and a sign-in.
// The progressive case, text before the cards, is pinned in
// __tests__/palChatStreaming.test.ts and proved against the real agent in the PR.

const PHONE = { width: 390, height: 844 };

const FINAL = {
  answer: "The cheapest listed pint in Soho is at The Crown for 4.80.",
  cards: [
    {
      key: "crown",
      venueId: "venue-crown",
      title: "The Crown",
      place: "Soho",
      note: "Listed pint.",
      price: 4.8,
      provenance: { label: "On record", kind: "directory" },
    },
  ],
  proposals: [],
  sources: [],
  status: "ready",
  toolsUsed: ["cheapest_pint_near"],
  conversationId: "conv_e2estream01",
};

test("a streamed answer lands as one bubble with its cards", async ({ page }) => {
  await page.setViewportSize(PHONE);
  const accepts: string[] = [];
  await page.route("**/api/pub-pal/chat", async (route) => {
    accepts.push(route.request().headers().accept ?? "");
    const events = [
      { type: "delta", text: "Let me check prices near Soho." },
      { type: "reset" },
      { type: "delta", text: "The cheapest listed pint in Soho" },
      { type: "final", body: FINAL },
    ];
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson; charset=utf-8",
      body: events.map((event) => `${JSON.stringify(event)}\n`).join(""),
    });
  });

  await page.goto("/pal/chat");
  await page.getByRole("textbox", { name: /Describe the outing/i }).fill("cheapest pint in Soho");
  await page.getByRole("button", { name: "Ask" }).click();

  const bubbles = page.locator(".palChatRow--pal .palChatBubble");
  await expect(bubbles).toHaveCount(1);
  await expect(bubbles.first()).toHaveText(FINAL.answer);
  await expect(page.locator(".palChatBubble--pending")).toHaveCount(0);
  await expect(page.getByTestId("pal-streaming-answer")).toHaveCount(0);
  await expect(page.locator(".palChatCard")).toHaveCount(1);
  expect(accepts).toEqual(["application/x-ndjson"]);
});
