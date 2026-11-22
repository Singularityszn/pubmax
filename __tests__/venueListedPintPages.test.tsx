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
import { bundledReadDay } from "@/__tests__/helpers/pintDatasetClock";

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
    const read = bundledReadDay("app_price_002417");
    expect(root.textContent).toContain(`Listed by Pint Prices, collected ${read.words}.`);
    expect(root.querySelector(`time[datetime="${read.iso}"]`)).not.toBeNull();
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

  const unrecorded = { pub_url: "", scraped_at_values: "" };
  it.each([
    { name: "one shared receipt", others: [{}], receipts: ["Listed by Pint Prices"] },
    {
      name: "a receipt on each row when no two agree",
      others: [unrecorded],
      receipts: ["Listed by Pint Prices", "Publisher not recorded. Read date unavailable."],
    },
    {
      name: "the shared receipt once and the odd row's own",
      others: [{}, unrecorded],
      receipts: ["Listed by Pint Prices", "Publisher not recorded. Read date unavailable."],
    },
  ])("prints $name under the pub's pint prices", async ({ others, receipts }) => {
    const id = "venue-16pnwmm";
    const read = await lookupVenueDetail(id);
    if (read.status !== "found") throw new Error("The Prospect record is unavailable");
    const pint = read.venue.prices.find((row) => row.pint_name === "Prospect Ale");
    if (!pint) throw new Error("The Prospect pint row is unavailable");
    const lookup = vi.spyOn(venueDetails, "lookupVenueDetail").mockResolvedValueOnce({
      status: "found",
      venue: {
        ...read.venue, prices: [
          pint,
          ...others.map((other, index) => ({
            ...pint, ...other, app_price_id: `cider-${index}`,
            pint_name: index ? `CIDER ${index}` : "HENRY WESTON'S VINTAGE CIDER", price_gbp: 6 + index,
          })),
        ],
      },
    });
    try {
      const root = document.createElement("div");
      root.innerHTML = renderToStaticMarkup(await PubPage({ params: Promise.resolve({ id }) }));
      const prices = root.querySelector('section[aria-labelledby="pub-pints-title"]');
      const printed = [...(prices?.querySelectorAll(".listedPriceSource") ?? [])].map((line) => line.textContent ?? "");
      expect(printed).toHaveLength(receipts.length);
      receipts.forEach((receipt, index) => expect(printed[index]).toContain(receipt));
      expect(prices?.querySelectorAll(".priceBadge")).toHaveLength(others.length + 1);
      expect(prices?.textContent).toContain("Henry Weston's Vintage Cider");
    } finally {
      lookup.mockRestore();
    }
  });

  it.each([
    { venueId: "bar-american-bar-savoy", venueName: "American Bar at The Savoy", price: null },
    { venueId: "venue-16pnwmm", venueName: "Prospect of Whitby", price: "£5.00" },
  ])("keeps pint receipts on the invite and prices out of metadata: $venueName", async ({ venueId, venueName, price }) => {
    plan.stops = [{ venueId, venueName, position: 0 }];
    const props = { params: Promise.resolve({ token: "pint-receipt" }) };
    const root = document.createElement("div");
    root.innerHTML = renderToStaticMarkup(await InvitePage(props));
    const metadata = await inviteMetadata(props);
    expect(root.textContent).toContain(venueName);
    expect(JSON.stringify(metadata)).not.toContain("£");
    expect(JSON.stringify(metadata)).not.toContain(venueName);
    expect(JSON.stringify(metadata)).not.toContain(venueId);
    expect(metadata.description).toContain("Join the crew to see the route");
    if (price) {
      expect(root.textContent).toContain(`${price} per pint`);
      expect(root.textContent).toContain(`Listed by Pint Prices, collected ${bundledReadDay("app_price_002417").words}.`);
    } else {
      expect(root.textContent).not.toContain("£25.00");
      expect(root.textContent).not.toContain("per pint");
      expect(metadata.description).not.toContain("per pint");
    }
  });
});

describe("where to meet on the invite", () => {
  const props = { params: Promise.resolve({ token: "pint-receipt" }) };

  it("names the first stop, its address and a way there before the guest answers", async () => {
    const read = await lookupVenueDetail("venue-16pnwmm");
    if (read.status !== "found") throw new Error("The Prospect record is unavailable");
    plan.stops = [
      { venueId: "bar-american-bar-savoy", venueName: "American Bar at The Savoy", position: 1 },
      { venueId: "venue-16pnwmm", venueName: "Prospect of Whitby", position: 0 },
    ];
    const root = document.createElement("div");
    root.innerHTML = renderToStaticMarkup(await InvitePage(props));
    const meet = root.querySelector(".invite__meet");
    expect(meet?.textContent).toContain("Prospect of Whitby");
    expect(read.venue.address).not.toBe("");
    expect(meet?.textContent).toContain(read.venue.address);
    const directions = meet?.querySelector<HTMLAnchorElement>("a");
    const href = new URL(directions!.href);
    expect(href.origin + href.pathname).toBe("https://www.google.com/maps/dir/");
    const [lat, lng] = href.searchParams.get("destination")!.split(",").map(Number);
    expect(Math.abs(lat! - read.venue.latitude)).toBeLessThan(0.001);
    expect(Math.abs(lng! - read.venue.longitude)).toBeLessThan(0.001);
    // The link sends the guest's position nowhere.
    expect(href.searchParams.has("origin")).toBe(false);
  });

  it("prints no address and no directions for a first stop it cannot place", async () => {
    plan.stops = [{ venueId: "venue-not-in-the-index", venueName: "The Unplaced Arms", position: 0 }];
    const root = document.createElement("div");
    root.innerHTML = renderToStaticMarkup(await InvitePage(props));
    const meet = root.querySelector(".invite__meet");
    expect(meet?.textContent).toContain("The Unplaced Arms");
    expect(meet?.querySelector("a")).toBeNull();
    expect(meet?.querySelector(".invite__meetAddress")).toBeNull();
  });
});
