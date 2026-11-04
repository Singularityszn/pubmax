// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import TodayPintsCard from "@/app/today/TodayPintsCard";
import TodayQuietPintCard from "@/app/today/TodayQuietPintCard";
import ListedPriceSource from "@/components/venue/ListedPriceSource";
import { buildTodayPintsForPatch } from "@/app/today/todayPints";
import { buildQuietPint, quietPintPriceEvidence } from "@/lib/quietPint";
import { venuePriceEvidence } from "@/lib/venuePriceEvidence";
import { CENTRAL_PATCH } from "@/lib/nightPatches";
import type { Venue } from "@/lib/venues";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  localStorage.clear();
});

function venue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: "test-pub",
    name: "The Test Arms",
    latitude: CENTRAL_PATCH.lat,
    longitude: CENTRAL_PATCH.lng,
    cheapestPrice: 4.8,
    cheapestPint: "Fixture lager",
    latestContributorPrice: null,
    prices: [{
      pint_name: "Fixture lager",
      price_gbp: 4.8,
      pub_url: "https://pint-prices.com/pubs/test-arms",
      scraped_at_values: "2026-01-15",
      measure: "pint",
    }],
    ...overrides,
  } as Venue;
}

async function mount(children: ReactNode): Promise<HTMLDivElement> {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(children));
  return host;
}

function quietModule(pub: Venue, evidence = quietPintPriceEvidence([pub])) {
  return buildQuietPint({
    candidates: [pub.id, "second", "third"].map((id) => ({
      venueId: id, name: id === pub.id ? pub.name : id, slug: id,
      hook: "An eighteenth-century pub.", era: "1700", listed: null,
      facts: [{ source: "wikipedia" as const, fact: "An eighteenth-century pub.", sourceRef: "https://en.wikipedia.org/wiki/Test_Arms" }],
    })),
    priceById: new Map([[pub.id, 4.8]]),
    priceEvidenceById: evidence,
    now: new Date("2026-07-21T09:00:00Z"),
  });
}

describe("Today's row price evidence", () => {
  it("shows the selected pint, serving, publisher and read date beside its amount", async () => {
    const pints = buildTodayPintsForPatch(CENTRAL_PATCH, [venue()])!;
    const host = await mount(<TodayPintsCard index={{ [CENTRAL_PATCH.id]: pints }} />);
    const row = host.querySelector("li")!;
    expect(row.textContent).toContain("£4.80");
    expect(row.textContent).toContain("Fixture lager · Pint");
    expect(row.querySelector('a[target="_blank"]')?.getAttribute("href"))
      .toBe("https://pint-prices.com/pubs/test-arms");
    expect(row.querySelector("time")?.textContent).toBe("15 January 2026");
  });

  it("keeps a contributor amount's own source and date when a listed row has the same amount", async () => {
    const pints = buildTodayPintsForPatch(CENTRAL_PATCH, [venue({
      latestContributorPrice: 4.8,
      latestContributorAt: "2026-10-01T12:00:00.000Z",
    })])!;
    const host = await mount(<TodayPintsCard index={{ [CENTRAL_PATCH.id]: pints }} />);
    const row = host.querySelector("li")!;
    expect(row.textContent).toContain("£4.80");
    expect(row.textContent).toContain("Corroborated Pint Drop");
    expect(row.textContent).toContain("Reported via Corroborated Pint Drop");
    expect(row.textContent).toContain("Drink not recorded · Serving not recorded");
    expect(row.textContent).toContain("Link unavailable");
    expect(row.querySelector("time")?.textContent).toBe("1 October 2026");
    expect(row.textContent).not.toContain("Fixture lager");
    expect(row.textContent).not.toContain("15 January");
    expect(row.querySelector('a[target="_blank"]')).toBeNull();
  });

  it("keeps the first equal-price row's facts without borrowing a later publisher", async () => {
    const pub = venue();
    pub.prices = [
      { ...pub.prices[0]!, pint_name: "First lager", pub_url: "https://first.example/menu", scraped_at_values: "2026-01-12" },
      { ...pub.prices[0]!, pint_name: "Later lager", pub_url: "https://later.example/menu", scraped_at_values: "2026-02-12" },
    ];
    const pints = buildTodayPintsForPatch(CENTRAL_PATCH, [pub])!;
    const host = await mount(<TodayPintsCard index={{ [CENTRAL_PATCH.id]: pints }} />);
    const row = host.querySelector("li")!;
    expect(row.textContent).toContain("First lager");
    expect(row.querySelector('a[target="_blank"]')?.getAttribute("href")).toBe("https://first.example/menu");
    expect(row.querySelector("time")?.textContent).toBe("12 January 2026");
    expect(row.textContent).not.toContain("Later lager");
    expect(row.textContent).not.toContain("12 February");
  });

  it("labels an unstated serving without changing the qualified price order", async () => {
    const pub = venue();
    delete (pub.prices[0] as { measure?: string }).measure;
    const pints = buildTodayPintsForPatch(CENTRAL_PATCH, [pub, venue({ id: "dearer", cheapestPrice: 6, prices: [], priceSource: "Pub menu", priceObservedAt: "2026-01-15" })])!;
    expect(pints.rows.map((row) => row.price)).toEqual([4.8, 6]);
    const host = await mount(<TodayPintsCard index={{ [CENTRAL_PATCH.id]: pints }} />);
    expect(host.querySelector("li")!.textContent).toContain("Serving not recorded");
  });

  it("keeps a quiet pint's price source separate from its history source", async () => {
    const pub = venue();
    const host = await mount(<TodayQuietPintCard module={quietModule(pub)} />);
    const row = [...host.querySelectorAll("li")].find((item) => item.textContent?.includes(pub.name))!;
    expect(row.textContent).toContain("£4.80");
    expect(row.textContent).toContain("Fixture lager · Pint");
    expect(row.querySelector('a[href="https://pint-prices.com/pubs/test-arms"]')?.textContent).toBe("Pint Prices");
    expect(row.querySelector("time")?.textContent).toBe("15 January 2026");
    expect(row.querySelector('a[href="https://en.wikipedia.org/wiki/Test_Arms"]')?.textContent).toContain("History");
  });

  it.each(["absent", "different amount"])("does not borrow history evidence when price evidence is %s", async (kind) => {
    const pub = venue();
    const evidence = kind === "absent" ? new Map() : new Map([[pub.id, venuePriceEvidence(pub, 6, false)]]);
    const host = await mount(<TodayQuietPintCard module={quietModule(pub, evidence)} />);
    const row = [...host.querySelectorAll("li")].find((item) => item.textContent?.includes(pub.name))!;
    expect(row.textContent).toContain("£4.80");
    expect(row.textContent).toContain("Drink not recorded · Serving not recorded");
    expect(row.textContent).toContain("Publisher not recorded. Read date unavailable.");
    expect(row.querySelector("time")).toBeNull();
    expect(row.querySelector('a[href="https://en.wikipedia.org/wiki/Test_Arms"]')).not.toBeNull();
  });

  it("keeps an unqualified quiet-pint amount visible with its own serving and unknown date", async () => {
    const pub = venue();
    Object.assign(pub.prices[0]!, { pint_name: "Half-pint lager", measure: "half", scraped_at_values: "2026-02-30" });
    const host = await mount(<TodayQuietPintCard module={quietModule(pub)} />);
    const row = [...host.querySelectorAll("li")].find((item) => item.textContent?.includes(pub.name))!;
    expect(row.textContent).toContain("£4.80");
    expect(row.textContent).toContain("Half-pint lager · Half");
    expect(row.textContent).toContain("Read date unavailable");
    expect(row.querySelector("time")).toBeNull();
  });

  it.each([null, "javascript:alert(1)"])("retains a recorded publisher without an unsafe or absent link: %s", async (url) => {
    const host = await mount(<ListedPriceSource evidence={{ publisher: { label: "Pub menu", url }, observedOn: null }} />);
    expect(host.textContent).toContain("Pub menu (Link unavailable)");
    expect(host.textContent).toContain("Read date unavailable");
    expect(host.textContent).not.toContain("Publisher not recorded");
    expect(host.querySelector("a")).toBeNull();
  });
});
