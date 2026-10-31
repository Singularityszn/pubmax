// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HypedPub } from "@/lib/hypedPubs";
import type { WhatsOnRow } from "@/lib/whatsOn";

/**
 * What a reader really meets, in a real DOM.
 *
 * Every earlier Tonight fence renders to static markup, so all of them passed
 * while the hydrated page led with "Deals tonight, Small Plates Club, J D
 * Wetherspoon" (Grok, 7 September 2026). This mounts the client the way a
 * browser does and reads the lede region back off the document.
 */

const NOW = Date.now();
const SOON = new Date(NOW + 90 * 60_000).toISOString();
const LATER = new Date(NOW + 180 * 60_000).toISOString();
const DEAL_DAY = new Date(NOW - 9 * 60 * 60_000).toISOString();
const EVENT_DAY = new Date(NOW - 6 * 60 * 60_000).toISOString();

// The shape production serves: four syndicated offers, each running at 24
// pubs. The grouping the main list already applies collapses each offer into
// one row that says how many pubs run it.
const JDW_OFFERS = [
  "Small Plates Club",
  "Curry club",
  "Steak club",
  "Afternoon deals",
];

const JDW_ROWS = Array.from({ length: 96 }, (_, index) => ({
  id: `deal-jdw-${index}`,
  venueId: `venue-jdw-${index}`,
  placeName: `The Moon Under Water ${index}`,
  kind: "deal",
  startsAt: SOON,
  endsAt: LATER,
  title: JDW_OFFERS[index % JDW_OFFERS.length],
  detail: "A range of pub classics at better prices.",
  source: {
    label: "J D Wetherspoon - Food & drink",
    url: "https://www.jdwetherspoon.com/food-drink/",
  },
  observedAt: DEAL_DAY,
  confidence: "listed",
})) as WhatsOnRow[];

const TICKETMASTER_ROWS = Array.from({ length: 24 }, (_, index) => ({
  id: `event-tm-${index}`,
  venueId: `venue-tm-${index}`,
  placeName: "A big room",
  kind: "event",
  startsAt: SOON,
  title: "Arena show from Ticketmaster",
  source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event" },
  observedAt: EVENT_DAY,
  confidence: "listed",
})) as WhatsOnRow[];

const OUT_EVENTS: WhatsOnRow[] = [];

const HYPED: HypedPub[] = [
  {
    name: "The Pelican Rise",
    area: "Peckham",
    venueId: null,
    whyLine: "Three London threads this week put it top for a Friday pint.",
    sources: [{ label: "r/london", url: "https://example.com/thread", observedAt: DEAL_DAY }],
    score: 9,
    mentions: 4,
  },
  {
    name: "The Dover Castle",
    area: "Fitzrovia",
    venueId: "venue-dover",
    whyLine: "Named again as the quiet one worth the walk.",
    sources: [{ label: "Time Out", url: "https://example.com/piece", observedAt: EVENT_DAY }],
    score: 6,
    mentions: 2,
  },
];

vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/nav/NowSegment", () => ({ default: () => null }));
vi.mock("@/app/tonight/TonightConditionsStrip", () => ({ default: () => null }));
vi.mock("@/app/tonight/TonightGetHomeStrip", () => ({ default: () => null }));
vi.mock("@/app/tonight/TonightShareButton", () => ({ default: () => null }));
vi.mock("@/components/desktop/AreaNewsRail", () => ({ default: () => null }));
vi.mock("@/components/out/EditorialRail", () => ({ default: () => null }));
vi.mock("@/components/discovery/DealsTonightLane", () => ({ default: () => null }));
vi.mock("@/components/discovery/MusicTonightLane", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/map/useWhatsOnTonight", () => ({
  useWhatsOnTonight: () => ({
    rows: [...JDW_ROWS, ...TICKETMASTER_ROWS],
    asOf: DEAL_DAY,
    sourceObservedAt: DEAL_DAY,
    sourceFreshnessKind: "dataset-generated",
    kindObservedAt: { deal: DEAL_DAY, event: EVENT_DAY },
    status: "ready",
    retry: () => {},
  }),
}));
vi.mock("@/components/out/useOutListings", () => ({
  useOutListings: () => ({
    body: { status: "ready", listingsStatus: "ready", events: OUT_EVENTS, reason: undefined },
    failed: false,
    pending: false,
    retry: () => {},
  }),
}));

const { default: TonightClient } = await import("@/app/tonight/TonightClient");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  OUT_EVENTS.length = 0;
});

async function mount(props: Record<string, unknown> = {}): Promise<void> {
  await act(async () => {
    root.render(createElement(TonightClient, props));
    await Promise.resolve();
  });
}

function ledeText(): string {
  const lede = container.querySelector('[data-testid="tonight-lede"]');
  expect(lede).not.toBeNull();
  return lede?.textContent ?? "";
}

describe("the tonight lede, hydrated", () => {
  it("explains why event listings without a pub match are absent", async () => {
    OUT_EVENTS.push({ ...TICKETMASTER_ROWS[0]!, id: "unmatched-arena", venueId: undefined });
    await mount();
    expect(container.textContent).toContain("Some event listings are not matched to a pub.");
  });

  it("keeps every Wetherspoon and Ticketmaster row out of the lede region", async () => {
    await mount();
    const lede = ledeText();
    expect(lede).not.toContain("Wetherspoon");
    expect(lede).not.toContain("Ticketmaster");
    expect(lede).not.toContain("Small Plates Club");
    expect(
      container
        .querySelector('[data-testid="tonight-screen"]')
        ?.getAttribute("data-listings-status"),
    ).toBe("empty");
  });

  it("leads with the pubs Londoners keep recommending when the pack carries rows", async () => {
    await mount({ hypedPubs: HYPED });
    const lede = ledeText();
    expect(lede).toContain("Pubs Londoners keep recommending");
    expect(lede).toContain("The Pelican Rise");
    expect(lede).toContain("r/london");
    expect(lede).toContain("Not on our map yet");
    expect(lede).not.toContain("Wetherspoon");
    expect(lede).not.toContain("Ticketmaster");
  });

  it("folds every pub's reason the same way, so no card is the odd one out", async () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({
      ...HYPED[index % HYPED.length]!,
      name: `Pub ${index + 1}`,
      venueId: null,
    }));
    await mount({ hypedPubs: rows });
    const pubs = Array.from(container.querySelectorAll('[data-testid="tonight-hyped-row"]'));
    expect(pubs).toHaveLength(6);
    for (const [index, pub] of pubs.entries()) {
      const reason = pub.querySelector<HTMLElement>(".tonightHypedReason");
      expect(reason, `card ${index + 1} folds its reason`).not.toBeNull();
      // A real button, so a screen reader and a role query find it (F20).
      const toggle = reason!.querySelector<HTMLButtonElement>("button.tonightHypedReasonToggle");
      expect(toggle?.textContent).toContain("Why this pub");
      expect(toggle?.getAttribute("aria-expanded")).toBe("false");
      const panel = reason!.querySelector<HTMLElement>(`#${CSS.escape(toggle!.getAttribute("aria-controls")!)}`);
      expect(panel?.hidden).toBe(true);
      expect(reason!.querySelector(".tonightHypedWhy")?.textContent).toBe(rows[index]!.whyLine);
      expect(reason!.querySelector(".tonightHypedSource")?.getAttribute("href"))
        .toBe(rows[index]!.sources[0]!.url);
      expect(reason!.querySelector(".tonightHypedChecked")?.textContent).toContain("Checked");
    }
    const more = container.querySelector<HTMLDetailsElement>(".tonightHypedMore");
    more!.querySelector("summary")!.click();
    expect(more?.open).toBe(true);
    expect(more?.querySelectorAll(".tonightHypedReason").length).toBeGreaterThan(0);
    const firstToggle = container.querySelector<HTMLButtonElement>("button.tonightHypedReasonToggle")!;
    await act(async () => firstToggle.click());
    expect(firstToggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(firstToggle.getAttribute("aria-controls")!)?.hidden).toBe(false);
  });

  it("leads with pubs the map can open and prints the listed pint we hold", async () => {
    const priced: HypedPub[] = [
      HYPED[0]!,
      {
        ...HYPED[1]!,
        listedPint: { priceGbp: 5.2, observedAt: "2026-09-01T10:00:00.000Z" },
      },
    ];
    await mount({ hypedPubs: priced });
    const pubs = Array.from(container.querySelectorAll('[data-testid="tonight-hyped-row"]'));
    // The pack ranks the unmatched pub louder; the map's pub still leads.
    expect(pubs.map((pub) => pub.querySelector(".tonightHypedName")?.textContent)).toEqual([
      "The Dover Castle",
      "The Pelican Rise",
    ]);
    const price = pubs[0]!.querySelector('[data-testid="tonight-hyped-price"]');
    expect(price?.textContent).toContain("Cheapest listed pint");
    expect(price?.textContent).toContain("£5.20");
    expect(price?.textContent).toContain("listed 1 Sept");
    expect(price?.querySelector("time")?.getAttribute("title")).toBe("1 September 2026");
    expect(pubs[1]!.querySelector('[data-testid="tonight-hyped-price"]')).toBeNull();
    expect(pubs[1]!.textContent).toContain("Not on our map yet");
  });

  it("does not call the city quiet beside pub suggestions", async () => {
    await mount({ hypedPubs: HYPED });
    expect(container.textContent).not.toContain("Quiet one tonight");
    expect(container.textContent).not.toContain("city’s having a quiet one tonight");
    expect(container.querySelector('[data-tonight-provenance="whats-on"]')?.textContent)
      .not.toContain("Quiet night");
    expect(ledeText()).toContain("No confirmed events listed tonight");
  });

  it("shows the chain supply under the lede, under the chain's own name", async () => {
    await mount({ hypedPubs: HYPED });
    const chains = container.querySelector('[data-testid="tonight-chain-lanes"]');
    expect(chains?.textContent).toContain("Wetherspoon deals tonight");
    expect(chains?.textContent).toContain("J D Wetherspoon - Food & drink");
    expect(chains?.textContent).toContain("Small Plates Club");
    // Three offers show and the fourth folds away, each row saying how many
    // pubs run that offer rather than repeating itself 24 times.
    expect(
      chains?.querySelectorAll(
        '.tonightChainList:not(.tonightChainMore .tonightChainList) [data-testid="tonight-chain-row"]',
      ).length,
    ).toBe(3);
    expect(chains?.textContent).toContain("Same deal at 24 pubs");
    expect(chains?.querySelector(".tonightChainMoreToggle")?.textContent).toContain(
      "One more offer",
    );
  });

  it("dates the chain-only source matches from the read that produced them", async () => {
    await mount();
    const provenance = container.querySelector('[data-tonight-provenance="whats-on"]');
    expect(provenance?.textContent).toContain("Pub-matched listings");
    expect(provenance?.textContent).toContain("Checked");
    expect(provenance?.textContent).not.toContain("Quiet night");
    expect(provenance?.textContent).not.toContain("No pub-matched events");
    expect(provenance?.textContent).not.toContain("No date on this yet");
  });

  it("puts real pubs above the vibe chips on a quiet night", async () => {
    await mount({
      cheapPints: [
        { venueId: "venue-cheap", name: "The Low Bell", borough: "Southwark", priceGbp: 4.2 },
      ],
    });
    const cheap = container.querySelector('[data-testid="tonight-cheap-pints"]');
    expect(cheap?.textContent).toContain("The Low Bell");
    expect(cheap?.textContent).toContain("£4.20");
  });
});
