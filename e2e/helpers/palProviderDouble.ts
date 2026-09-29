import type { Page } from "@playwright/test";

// Browser journeys exercise Pal's UI with grounded, deterministic provider replies.
// The real keyless route remains fail-closed and is covered by pubPalChatRoute.test.ts.
export async function mockPalVenueAnswer(page: Page) {
  await page.route("**/api/pub-pal/chat", async (route) => {
    const request = route.request().postDataJSON() as { query?: string };
    if (request.query !== "Quiet-ish near Bank, not pricey") {
      throw new Error(`Unexpected Pal venue query: ${request.query}`);
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ready",
        answer: "The Bell is a pub near Bank.",
        cards: [{
          key: "venue-1h7w6h3",
          venueId: "venue-1h7w6h3",
          title: "The Bell",
          place: "Bank",
          note: "Listed near Bank in the venue directory.",
          price: null,
          provenance: { label: "Venue directory", kind: "directory" },
        }],
        proposals: [],
      }),
    });
  });
}

export async function mockPalPlanAnswer(page: Page) {
  await page.route("**/api/pub-pal/chat", async (route) => {
    const request = route.request().postDataJSON() as { query?: string };
    if (request.query !== "Plan a crawl in Soho for 4") {
      throw new Error(`Unexpected Pal plan query: ${request.query}`);
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ready",
        answer: "Here are three listed Soho pubs for your crawl.",
        cards: [],
        proposals: [{
          id: "soho-crawl",
          kind: "draft_plan",
          label: "Open in Plan",
          query: "Plan a crawl in Soho for 4",
          stopIds: ["venue-1t8siin", "venue-xiesdn", "venue-806vol"],
          stopNames: ["The Crown & Two Chairmen", "The Dog & Duck", "The Ship Soho"],
        }],
      }),
    });
  });
}

/**
 * Grounded fixtures for phone concierge journeys. The venue IDs, areas,
 * prices, and beer-garden flag mirror rows in the committed London venue pack.
 * The real keyless chat route is exercised separately and remains fail-closed.
 */
export async function mockPalConciergePhoneAnswers(page: Page) {
  const replies = {
    "Quiet-ish near Bank, not pricey": {
      answer:
        "The Bell is listed in the City of London. Quietness and current prices are not on record.",
      cards: [{
        key: "venue-1h7w6h3",
        venueId: "venue-1h7w6h3",
        title: "The Bell",
        place: "City of London",
        note: "Listed in the City of London; no quietness or price record.",
        price: null,
        provenance: { label: "On record", kind: "directory" },
      }],
      proposals: [],
    },
    "Cheapest pint in Camden tonight": {
      answer:
        "Cheapest listed pints in Camden start at £3.40 at Ye Olde Swiss Cottage. I can't confirm a tonight-specific offer.",
      cards: [{
        key: "venue-18uogns",
        venueId: "venue-18uogns",
        title: "Ye Olde Swiss Cottage",
        place: "Camden",
        note: "£3.40 listed starting price.",
        price: 3.4,
        provenance: { label: "On record", kind: "directory" },
      }],
      proposals: [],
    },
    "Somewhere to work with wifi in Angel": {
      answer:
        "No seat data yet. Nobody has logged a desk-friendly seat, a plug or wifi anywhere, so I won't point you at one.",
      cards: [],
      proposals: [],
    },
    "Quiet pub in Camden for four": {
      answer:
        "The Garden Gate is listed in Camden with a beer garden. Quietness and group capacity are not on record.",
      cards: [{
        key: "venue-1l86ijg",
        venueId: "venue-1l86ijg",
        title: "The Garden Gate",
        place: "Camden",
        note: "Beer garden listed in the venue record.",
        price: 6.25,
        provenance: { label: "On record", kind: "directory" },
      }],
      proposals: [],
    },
    cheaper: {
      answer:
        "Ye Olde Swiss Cottage has a listed starting price of £3.40 in Camden.",
      cards: [{
        key: "venue-18uogns",
        venueId: "venue-18uogns",
        title: "Ye Olde Swiss Cottage",
        place: "Camden",
        note: "£3.40 listed starting price.",
        price: 3.4,
        provenance: { label: "On record", kind: "directory" },
      }],
      proposals: [],
    },
    "anything in Camden with a garden": {
      answer:
        "The Garden Gate is listed in Camden with a beer garden; no current opening status is included here.",
      cards: [{
        key: "venue-1l86ijg",
        venueId: "venue-1l86ijg",
        title: "The Garden Gate",
        place: "Camden",
        note: "Beer garden listed in the venue record.",
        price: 6.25,
        provenance: { label: "On record", kind: "directory" },
      }],
      proposals: [],
    },
  } as const;

  await page.route("**/api/pub-pal/chat", async (route) => {
    const request = route.request().postDataJSON() as {
      query?: string;
      turns?: Array<{ role?: unknown; content?: unknown }>;
    };
    const reply = request.query
      ? replies[request.query as keyof typeof replies]
      : undefined;
    if (!reply) {
      throw new Error(`Unexpected Pub Pal phone query: ${request.query}`);
    }
    const expectedPriorAsk =
      request.query === "cheaper"
        ? "Quiet pub in Camden for four"
        : request.query === "anything in Camden with a garden"
          ? "cheaper"
          : null;
    if (
      expectedPriorAsk &&
      !request.turns?.some(
        (turn) => turn.role === "user" && turn.content === expectedPriorAsk,
      )
    ) {
      throw new Error(
        `Pub Pal did not forward earlier ask before follow-up: ${expectedPriorAsk}`,
      );
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ready", ...reply }),
    });
  });
}
