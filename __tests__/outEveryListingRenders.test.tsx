// @vitest-environment jsdom

// /out prints every sourced listing.
//
// Live walk B4, 6 September 2026: /out answered 31, 54 and 63 sourced listings
// for tonight, tomorrow and the weekend, matched none of them to a pub, and
// rendered ZERO rows on all three days - one apologetic count and "Open the
// map". The listings were held and the reader was told nothing about them.
//
// The law this fences: a listing we hold is a listing we show. The pub is a
// footnote on the row, never a filter in front of it, and the page's primary
// is a product action (the map), never a listing.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/out",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children?: unknown;
    href: string;
    prefetch?: boolean;
  }) => {
    const attrs: Record<string, unknown> = { ...rest };
    delete attrs.prefetch;
    return createElement("a", { href, ...attrs }, children as never);
  },
}));

import OutClient from "@/app/out/OutClient";
import type { OutResponse } from "@/lib/out/types";
import type { WhatsOnRow } from "@/lib/whatsOn";

const NOW = Date.UTC(2026, 8, 7, 19, 0, 0);
const UNMATCHED_COUNT = 148;

function unmatchedRow(index: number): WhatsOnRow {
  const startsAt = new Date(NOW + (index % 6) * 30 * 60_000).toISOString();
  return {
    id: `tm-${index}`,
    kind: "event",
    title: `Sourced listing ${index}`,
    placeName: `The Unlisted Room ${index}`,
    startsAt,
    detail: index % 2 === 0 ? "Rock" : "Comedy",
    source: {
      label: "Ticketmaster",
      url: `https://www.ticketmaster.co.uk/event/${index}`,
    },
    observedAt: new Date(NOW - 60_000).toISOString(),
    confidence: "listed",
  };
}

function body(rows: WhatsOnRow[]): OutResponse {
  return {
    status: "ready",
    listingsStatus: "ready",
    events: rows,
    openPlans: [],
    openPlansStatus: "ready",
    attribution: [
      { label: "Ticketmaster", logoRequired: false, url: "https://www.ticketmaster.co.uk/" },
    ],
    observedAt: {},
    providers: [{ name: "ticketmaster", configured: true, rows: rows.length, status: "ready" }],
    unmatchedCount: rows.length,
    unmatchedPlaces: rows.slice(0, 6).map((row) => row.placeName),
    unmatchedPlaceCount: rows.length,
    unmatchedSources: ["Ticketmaster"],
    venueMatch: "ready",
  };
}

let container: HTMLDivElement;
let root: Root | null = null;

async function renderOut(rows: WhatsOnRow[], day: "tonight" | "tomorrow" | "weekend" = "tonight", venueMatch: OutResponse["venueMatch"] = "ready") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ ...body(rows), venueMatch }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(OutClient, { day }));
  });
  await act(async () => {});
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom ships no matchMedia and the site chrome reads it on mount. The page
  // under test is the listings, so the chrome is given the answer it needs
  // rather than being cut out of the render.
  vi.stubGlobal(
    "matchMedia",
    (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  );
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("a night of unmatched listings renders rows, not an empty state", () => {
  it.each([
    ["tonight", "Tonight", "What’s on tonight."],
    ["tomorrow", "Tomorrow", "What’s on tomorrow."],
    ["weekend", "Weekend", "What’s on this weekend."],
  ] as const)("names the selected %s period in the page heading", async (day, label, heading) => {
    await renderOut([], day);

    expect(container.querySelector("h1#out-title")?.textContent).toBe(heading);
    const selectedChip = container.querySelector('.outDayChips a[aria-current="page"]');
    expect(selectedChip?.textContent).toBe(label);
  });

  it("counts listings shown separately from their map links", async () => {
    await renderOut([
      { ...unmatchedRow(0), venueId: "venue-4xlgb0" },
      unmatchedRow(1),
      unmatchedRow(2),
    ]);

    expect(container.querySelector('[data-testid="out-listing-count"]')?.textContent).toBe(
      "3 listings shown. 1 linked to a venue on our map.",
    );
    expect(container.querySelectorAll('[data-testid="out-listing-row"]')).toHaveLength(3);
  });

  it("does not count venue links when the match could not run", async () => {
    await renderOut([{ ...unmatchedRow(0), venueId: "venue-4xlgb0" }], "tonight", "unavailable");

    expect(container.querySelector('[data-testid="out-listing-count"]')?.textContent).toBe(
      "1 listing shown.",
    );
  });

  it("prints all 148 sourced listings as real rows", async () => {
    const rows = Array.from({ length: UNMATCHED_COUNT }, (_, index) => unmatchedRow(index));
    await renderOut(rows);

    const rendered = container.querySelectorAll('[data-testid="out-listing-row"]');
    expect(rendered.length).toBe(UNMATCHED_COUNT);
    expect(container.textContent).toContain("Sourced listing 0");
    expect(container.textContent).toContain(`Sourced listing ${UNMATCHED_COUNT - 1}`);
  });

  it("says the pub match is unresolved on the row, and shows no empty state over the list", async () => {
    const rows = Array.from({ length: UNMATCHED_COUNT }, (_, index) => unmatchedRow(index));
    await renderOut(rows);

    const absent = container.querySelectorAll(".outListingPubPair--absent");
    expect(absent.length).toBe(UNMATCHED_COUNT);
    expect(absent[0]?.textContent).toBe("We haven’t linked this place to a pub on our map.");
    // The old page's whole answer. It may not stand over 148 rendered rows.
    expect(container.textContent).not.toContain("are at places we don't list yet");
    expect(container.textContent).not.toContain("No listings for this day yet.");
  });

  it("carries every row's own title, place, time and source credit", async () => {
    await renderOut([unmatchedRow(3)]);

    const row = container.querySelector('[data-testid="out-listing-row"]');
    expect(row).not.toBeNull();
    expect(row?.querySelector("h4")?.textContent).toBe("Sourced listing 3");
    expect(row?.querySelector(".outCardPlace")?.textContent).toBe("The Unlisted Room 3");
    expect(row?.querySelector(".outCardWhen")?.textContent).toMatch(/\d{2}:\d{2}/);
    const credit = row?.querySelector<HTMLAnchorElement>("a.outSourceCredit");
    expect(credit?.textContent).toBe("Ticketmaster");
    expect(credit?.getAttribute("href")).toBe("https://www.ticketmaster.co.uk/event/3");
  });

  it("keeps the map as the primary, never a listing's title", async () => {
    const rows = Array.from({ length: 4 }, (_, index) => unmatchedRow(index));
    await renderOut(rows);

    const primaries = container.querySelectorAll("[data-primary-action]");
    expect(primaries.length).toBe(1);
    const primary = container.querySelector<HTMLAnchorElement>(
      "[data-primary-action] a",
    );
    expect(primary?.textContent).toBe("Open the map");
    expect(primary?.getAttribute("href")).toBe("/map");
    for (const index of [0, 1, 2, 3]) {
      expect(primaries[0]?.textContent).not.toContain(`Sourced listing ${index}`);
    }
  });

  it("leads a night with nothing at a pub of ours with the honest line, then the rest", async () => {
    const rows = Array.from({ length: 25 }, (_, index) => unmatchedRow(index));
    await renderOut(rows);

    const lead = container.querySelector('[data-testid="out-honest-empty"]');
    expect(lead?.textContent).toContain(
      "We couldn’t match any of tonight’s 25 listings to a pub on our map.",
    );
    expect(lead?.querySelector("a")?.getAttribute("href")).toBe("/tonight");

    const heading = container.querySelector("#out-unmatched-heading");
    expect(heading?.textContent).toBe("Places we couldn’t match");
    const firstRow = container.querySelector('[data-testid="out-listing-row"]');
    expect(
      (lead as Element).compareDocumentPosition(heading as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      (heading as Element).compareDocumentPosition(firstRow as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(container.querySelectorAll('[data-testid="out-listing-row"]').length).toBe(25);
  });

  it("groups the rows under the night they are on", async () => {
    // One night under a section heading that already names it needs no second
    // heading, so the night is on the section's accessible name instead.
    await renderOut([unmatchedRow(0)]);
    expect(container.querySelector(".outGroupTitle")).toBeNull();
    expect(container.querySelector(".outGroup")?.getAttribute("aria-label")).toBe("Tonight");

    // Two nights under one chip DO need their headings.
    await act(async () => {
      root?.unmount();
    });
    container.remove();
    await renderOut([
      unmatchedRow(0),
      { ...unmatchedRow(1), startsAt: new Date(NOW + 24 * 60 * 60 * 1000).toISOString() },
    ]);
    expect(
      [...container.querySelectorAll(".outGroupTitle")].map((node) => node.textContent),
    ).toEqual(["Tonight", "Tomorrow"]);
  });

  it("nests each listing under its night inside the not-on-our-map block", async () => {
    await renderOut(
      [
        unmatchedRow(0),
        { ...unmatchedRow(1), startsAt: new Date(NOW + 24 * 60 * 60 * 1000).toISOString() },
      ],
      "weekend",
    );

    const block = container.querySelector(".outUnmatchedBlock");
    expect(block?.querySelector("#out-unmatched-heading")?.tagName).toBe("H3");
    const groupTitles = [...(block?.querySelectorAll(".outGroupTitle") ?? [])];
    expect(groupTitles).toHaveLength(2);
    expect(groupTitles.every((node) => node.tagName === "H4")).toBe(true);
    const rowTitles = [
      ...(block?.querySelectorAll('[data-testid="out-listing-row"] :is(h2, h3, h4, h5, h6)') ??
        []),
    ];
    expect(rowTitles.map((node) => node.tagName)).toEqual(["H5", "H5"]);
  });

  it("credits the publishers under the list, never above it", async () => {
    await renderOut([unmatchedRow(0)]);
    const surface = container.querySelector('[data-testid="out-listing-surface"]');
    const credit = container.querySelector('[data-testid="out-listing-credit"]');
    expect(surface).not.toBeNull();
    expect(credit).not.toBeNull();
    expect(credit?.textContent).toContain("Ticketmaster");
    const position = (surface as Element).compareDocumentPosition(credit as Node);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("a matched listing keeps its pub link and its pin", () => {
  it("names the pub, badges it, and links the map to that venue", async () => {
    const matched: WhatsOnRow = {
      ...unmatchedRow(0),
      venueId: "venue-lexington",
      placeName: "The Lexington",
    };
    await renderOut([matched]);

    const pair = container.querySelector(".outListingPubPair--matched");
    expect(pair?.textContent).toContain("The Lexington");
    expect(pair?.querySelector<HTMLAnchorElement>("a")?.getAttribute("href")).toBe(
      "/map?sel=venue-lexington",
    );
  });

  it("leads with listings at a pub of ours, and the rest follow under their own heading", async () => {
    const matched: WhatsOnRow = {
      ...unmatchedRow(1),
      venueId: "venue-lexington",
      placeName: "The Lexington",
    };
    await renderOut([unmatchedRow(0), matched, unmatchedRow(2)]);

    expect(container.querySelector('[data-testid="out-honest-empty"]')).toBeNull();
    const titles = [
      ...container.querySelectorAll('[data-testid="out-listing-row"] h4'),
    ].map((node) => node.textContent);
    expect(titles).toEqual(["Sourced listing 1", "Sourced listing 0", "Sourced listing 2"]);

    const heading = container.querySelector("#out-unmatched-heading");
    const matchedRow = container.querySelector('[data-testid="out-listing-row"]');
    const unmatchedRows = container.querySelectorAll('[data-testid="out-listing-row"]');
    expect(
      (matchedRow as Element).compareDocumentPosition(heading as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      (heading as Element).compareDocumentPosition(unmatchedRows[1] as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("a night with nothing on still has a way onward", () => {
  it("keeps the map as the primary when no listing can lead", async () => {
    await renderOut([]);
    const primary = container.querySelector<HTMLAnchorElement>("[data-primary-action] a");
    expect(primary?.textContent).toBe("Open the map");
  });
});
