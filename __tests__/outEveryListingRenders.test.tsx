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
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
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
import type { HeldOutAnswer } from "@/components/out/useOutListings";
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

async function renderOut(rows: WhatsOnRow[], day: "tonight" | "tomorrow" | "weekend" = "tonight", venueMatch: OutResponse["venueMatch"] = "ready", initialAnswer?: HeldOutAnswer, apiAnswer?: OutResponse) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify(apiAnswer ?? { ...body(rows), venueMatch }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(OutClient, { day, initialAnswer }));
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


describe("the public server answer belongs to one city and service day", () => {
  it.each(["tonight", "tomorrow", "weekend"] as const)(
    "restores Open plans from a listings-only %s seed",
    async (day) => {
      const rows = [unmatchedRow(0)];
      const seed = body(rows);
      delete seed.openPlansStatus;
      const apiAnswer = body(rows);
      apiAnswer.openPlans = [{
        crewId: "50000000-0000-4000-8000-000000000001",
        title: "Meet at the Lexington",
        startTime: "2026-09-07T19:30:00Z",
        stopVenueId: "venue-lexington",
        stopVenueName: "The Lexington",
        hostHandle: "alice",
        memberCount: 2,
        meetingPoint: { kind: "venue", name: "The Lexington", lat: 51.53, lng: -0.11 },
      }];
      await renderOut(rows, day, "ready", {
        city: "london", day: day === "tonight" ? "today" : day,
        body: seed, failed: false, servedAt: NOW - 1_000,
      }, apiAnswer);
      expect(container.querySelector(".outOpenPlanTitle")?.textContent).toBe("Meet at the Lexington");
      expect(container.querySelector(".outOpenPlanLink")?.getAttribute("href")).toBe(
        "/social/crews/50000000-0000-4000-8000-000000000001",
      );
    },
  );

  it.each([
    ["preview", "Open plans are in preview."],
    ["degraded", "Open plans could not be checked."],
  ] as const)("restores the %s Open plans status", async (status, line) => {
    const rows = [unmatchedRow(0)];
    const seed = body(rows);
    delete seed.openPlansStatus;
    await renderOut(rows, "tonight", "ready", {
      city: "london", day: "today", body: seed, failed: false, servedAt: NOW - 1_000,
    }, { ...body(rows), openPlansStatus: status, openPlans: status === "preview" ? null : [] });
    expect(container.querySelector(".outPlans")?.textContent).toContain(line);
  });

  it.each([
    { name: "a fresh London answer", city: "london" as const },
    { name: "another city's answer", city: "manchester" as const },
  ])("reads the API once for $name", async ({ city }) => {
    const rows = [unmatchedRow(0)];
    await renderOut(rows, "tonight", "ready", {
      city, day: "today", body: body(rows), failed: false, servedAt: NOW - 1_000,
    });
    const calls = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith("/api/out?"));
    expect(calls.map(([url]) => String(url))).toEqual(["/api/out?city=london&day=today"]);
    expect(container.textContent).toContain("Sourced listing 0");
  });

  it("reads the API once more when a refresh brings a new listings-only seed", async () => {
    const rows = [unmatchedRow(0)];
    const seed = body(rows);
    delete seed.openPlansStatus;
    await renderOut(rows, "tonight", "ready", {
      city: "london", day: "today", body: seed, failed: false, servedAt: NOW - 1_000,
    });
    const outReads = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith("/api/out?"));
    expect(outReads()).toHaveLength(1);

    const refreshedRows = [unmatchedRow(0), unmatchedRow(1)];
    const refreshedSeed = body(refreshedRows);
    delete refreshedSeed.openPlansStatus;
    vi.mocked(fetch).mockImplementationOnce(async () => Response.json(body(refreshedRows)));
    await act(async () => {
      root?.render(createElement(OutClient, {
        day: "tonight",
        initialAnswer: { city: "london", day: "today", body: refreshedSeed, failed: false, servedAt: NOW },
      }));
    });
    await act(async () => {});

    expect(outReads().map(([url]) => String(url))).toEqual([
      "/api/out?city=london&day=today",
      "/api/out?city=london&day=today",
    ]);
    expect(container.querySelectorAll('[data-testid="out-listing-row"]')).toHaveLength(2);
    expect(container.textContent).toContain("Sourced listing 1");
  });
});

describe.each(["split", "unmatched-only", "unavailable"] as const)("%s seeded group labels survive hydration across the London service rollover", (mode) => {
  it.each([
    ["2026-10-17T02:59:59Z", "2026-10-17T03:00:01Z", "2026-10-17", "Sunday 18 October"],
    ["2026-03-29T02:59:59Z", "2026-03-29T03:00:01Z", "2026-03-29", "Monday 30 March"],
    ["2026-10-25T03:59:59Z", "2026-10-25T04:00:01Z", "2026-10-25", "Monday 26 October"],
  ])("holds matched and unmatched labels from %s until the API answers", async (before, after, eventDate, nextLabel) => {
    const startsAt = `${eventDate}T19:00:00Z`;
    const nextStartsAt = new Date(Date.parse(startsAt) + 24 * 60 * 60_000).toISOString();
    const allRows = [
      { ...unmatchedRow(0), startsAt, venueId: "venue-lexington" },
      { ...unmatchedRow(1), startsAt: nextStartsAt, venueId: "venue-lexington" },
      { ...unmatchedRow(2), startsAt },
      { ...unmatchedRow(3), startsAt: nextStartsAt },
    ];
    const rows = mode === "unmatched-only" ? allRows.slice(2) : allRows;
    const response = { ...body(rows), venueMatch: mode === "unavailable" ? "unavailable" as const : "ready" as const };
    const props = {
      day: "weekend" as const,
      initialAnswer: {
        city: "london" as const, day: "weekend" as const,
        body: response, failed: false, servedAt: Date.parse(before),
      },
    };
    container = document.createElement("div");
    document.body.append(container);
    vi.setSystemTime(new Date(before));
    container.innerHTML = renderToString(createElement(OutClient, props));
    const labels = () => [...container.querySelectorAll(".outGroupTitle")].map((node) => node.textContent);
    const heldLabels = mode === "split" ? ["Tomorrow", nextLabel, "Tomorrow", nextLabel] : ["Tomorrow", nextLabel];
    expect(labels()).toEqual(heldLabels);

    let resolveRead!: (response: Response) => void;
    const read = new Promise<Response>((resolve) => { resolveRead = resolve; });
    vi.stubGlobal("fetch", vi.fn(() => read));
    const onRecoverableError = vi.fn();
    vi.setSystemTime(new Date(after));
    await act(async () => {
      root = hydrateRoot(container, createElement(OutClient, props), { onRecoverableError });
    });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(labels()).toEqual(heldLabels);

    await act(async () => {
      resolveRead(Response.json(response));
      await read;
    });
    expect(labels()).toEqual(mode === "split" ? ["Tonight", "Tomorrow", "Tonight", "Tomorrow"] : ["Tonight", "Tomorrow"]);
  });
});
