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
    body: { status: "ready", listingsStatus: "ready", events: [], reason: undefined },
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

  it("leads with the pubs people are talking about when the pack carries rows", async () => {
    await mount({ hypedPubs: HYPED });
    const lede = ledeText();
    expect(lede).toContain("Pubs people are talking about");
    expect(lede).toContain("The Pelican Rise");
    expect(lede).toContain("r/london");
    expect(lede).toContain("Not on our map yet");
    expect(lede).not.toContain("Wetherspoon");
    expect(lede).not.toContain("Ticketmaster");
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

  it("dates the quiet night from the read that produced it", async () => {
    await mount();
    const provenance = container.querySelector('[data-tonight-provenance="whats-on"]');
    expect(provenance?.textContent).toContain("Quiet night");
    expect(provenance?.textContent).toContain("Checked");
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
