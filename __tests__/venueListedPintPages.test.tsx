/** @vitest-environment jsdom */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
const plan = vi.hoisted(() => ({ stops: [] as Array<{ venueId: string; venueName: string; position: number }> }));
vi.mock("@/lib/planStore", () => ({
  resolvePlanIdByInviteToken: async () => ({ ok: true, planId: "plan-pint-receipt" }),
  planStateResult: async () => ({
    ok: true,
    plan: {
      plan: { title: "A night out", startTime: "2026-10-21T19:00:00.000Z" },
      crew: [{ name: "host" }], context: null, stops: plan.stops,
    },
  }),
}));
vi.mock("@/lib/planInviteRsvpStore", () => ({
  rsvpStore: () => ({ summarize: async () => ({ counts: { going: 0, maybe: 0 }, guests: [] }) }),
  reactionStore: () => ({ summarize: async () => ({ counts: {}, mine: [] }) }),
}));
vi.mock("@/components/plan/PlanInviteRsvp", () => ({ default: () => null }));
vi.mock("@/components/plan/InvitePageView", () => ({ default: () => null }));

import LedgerPage from "@/app/ledger/[id]/page";
import PubPage from "@/app/pubs/[id]/page";
import InvitePage, { generateMetadata as inviteMetadata } from "@/app/invite/[token]/page";
import { lookupVenueDetail } from "@/lib/venueDetailIndex";
import * as venueDetails from "@/lib/venueDetailIndex";
import { venueListedPint } from "@/lib/venueListedPint";

describe("pint receipts on venue pages", () => {
  it("carries Small Beer's bundled listing into the cached Ledger document", async () => {
    const root = document.createElement("div");
    root.innerHTML = renderToStaticMarkup(await LedgerPage({ params: Promise.resolve({ id: "venue-19mn6ss" }) }));
    const priceRecord = root.querySelector('section[aria-labelledby="ledgerPriceHeading"]');
    expect(priceRecord?.querySelector(".priceBadge")?.textContent).toBe("£5.00");
    expect(priceRecord?.querySelector('a[href="https://www.smallbeern8.co.uk/drinks"]')?.textContent).toBe("smallbeern8.co.uk");
    expect(priceRecord?.querySelector("time")?.dateTime).toBe("2026-10-23T16:15:47.970Z");
    expect(priceRecord?.textContent).toContain("collected 23 October 2026");
    expect(priceRecord?.textContent).not.toContain("Public pint report");
  });
  it.each([
    { name: "Ledger", page: LedgerPage },
    { name: "pub", page: PubPage },
  ])("keeps the Savoy cocktail out of the $name pint prices", async ({ page }) => {
    const id = "bar-american-bar-savoy";
    const read = await lookupVenueDetail(id);
    expect(read.status).toBe("found");
    if (read.status !== "found") throw new Error("The Savoy record is unavailable");
    expect(read.venue).toMatchObject({
      cheapestPrice: 25, cheapestPint: "", prices: [],
      anchorLabel: "Welcome to The Savoy",
    });
    const root = document.createElement("div");
    root.innerHTML = renderToStaticMarkup(await page({ params: Promise.resolve({ id }) }));
    expect(root.querySelector("h1")?.textContent).toBe("American Bar at The Savoy");
    expect(root.textContent).not.toContain("£25.00");
    expect(root.textContent).not.toContain("Cheapest listed pint");
    expect(root.textContent).not.toContain("cheapest pint");
    expect(root.textContent).not.toContain("Publisher not recorded");
    expect(venueListedPint(read.venue)).toBeNull();
  });

  it.each([
    { name: "Ledger", page: LedgerPage },
    { name: "pub", page: PubPage },
  ])("keeps the real Prospect pint and its receipt on the $name page", async ({ page }) => {
    const root = document.createElement("div");
    root.innerHTML = renderToStaticMarkup(await page({ params: Promise.resolve({ id: "venue-16pnwmm" }) }));
    expect(root.querySelector("h1")?.textContent).toBe("Prospect of Whitby");
    expect(root.textContent).toContain("£5.00");
    expect(root.textContent).toContain("Prospect Ale");
    expect(root.textContent).toContain("Listed by Pint Prices, collected 2 October 2026.");
    expect(root.querySelector('time[datetime="2026-10-02"]')).not.toBeNull();
    expect(root.querySelector('a[href="https://www.pint-prices.com/pub/57%20Wapping%20Wall,%20E1W%203SH/Prospect%20of%20Whitby"]')).not.toBeNull();
  });

  it("requires a named pint row carrying the displayed figure", () => {
    expect(venueListedPint({
      cheapestPrice: 5, cheapestPint: "", prices: [],
    })).toBeNull();
    expect(venueListedPint({
      cheapestPrice: 5, cheapestPint: "Ale", prices: [{
        app_price_id: "other-price", pint_name: "Ale", price_gbp: 6,
        pub_url: "https://example.com/menu", scraped_at_values: "2026-10-01T12:00:00Z",
      }],
    })).toBeNull();
  });

  it.each([
    { name: "Ale", price: 6 },
    { name: "Another Ale", price: 5 },
  ])("does not borrow another pint row's publisher or date: $name $price", ({ name, price }) => {
    expect(venueListedPint({
      cheapestPrice: 5, cheapestPint: "Ale", prices: [
        { app_price_id: "pint", pint_name: "Ale", price_gbp: 5 },
        {
          app_price_id: "other-price", pint_name: name, price_gbp: price,
          pub_url: "https://example.com/menu", scraped_at_values: "2026-10-01T12:00:00Z",
        },
      ],
    })).toEqual({ priceGbp: 5, pintName: "Ale", publisher: null, observedOn: null });
  });

  it("keeps unknown provenance on a displayed minimum instead of borrowing a dearer row's receipt", async () => {
    const id = "venue-16pnwmm";
    const read = await lookupVenueDetail(id);
    if (read.status !== "found") throw new Error("The Prospect record is unavailable");
    const pint = read.venue.prices.find((row) => row.pint_name === "Prospect Ale");
    if (!pint) throw new Error("The Prospect pint row is unavailable");
    const lookup = vi.spyOn(venueDetails, "lookupVenueDetail").mockResolvedValueOnce({
      status: "found",
      venue: {
        ...read.venue, prices: [
          { ...pint, pub_url: "", scraped_at_values: "" },
          { ...pint, app_price_id: "dearer-pint", price_gbp: 6 },
        ],
      },
    });
    try {
      const root = document.createElement("div");
      root.innerHTML = renderToStaticMarkup(await PubPage({ params: Promise.resolve({ id }) }));
      const prices = root.querySelector('section[aria-labelledby="pub-pints-title"]');
      expect(prices?.textContent).toContain("£5.00");
      expect(prices?.textContent).toContain("Publisher not recorded. Read date unavailable.");
      expect(prices?.textContent).not.toContain("Pint Prices");
      expect(prices?.querySelector("time")).toBeNull();
    } finally {
      lookup.mockRestore();
    }
  });

  it.each([
    { venueId: "bar-american-bar-savoy", venueName: "American Bar at The Savoy", price: null },
    { venueId: "venue-16pnwmm", venueName: "Prospect of Whitby", price: "£5.00" },
  ])("uses only a pint price in the invite and its metadata: $venueName", async ({ venueId, venueName, price }) => {
    plan.stops = [{ venueId, venueName, position: 0 }];
    const props = { params: Promise.resolve({ token: "pint-receipt" }) };
    const root = document.createElement("div");
    root.innerHTML = renderToStaticMarkup(await InvitePage(props));
    const metadata = await inviteMetadata(props);
    expect(root.textContent).toContain(venueName);
    if (price) {
      expect(root.textContent).toContain(`${price} per pint`);
      expect(root.textContent).toContain("Listed by Pint Prices, collected 2 October 2026.");
      expect(metadata.description).toContain(`${price} per pint`);
    } else {
      expect(root.textContent).not.toContain("£25.00");
      expect(root.textContent).not.toContain("per pint");
      expect(metadata.description).not.toContain("per pint");
    }
  });
});
