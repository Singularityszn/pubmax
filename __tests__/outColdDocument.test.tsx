// @vitest-environment jsdom

// A cold /out document never waits on a live listings provider.
//
// Private production build, 16 Oct 2026 (artifacts/out-provider-ssr-2126):
// with a configured Ticketmaster key and an upstream that did not answer, the
// cold /out document took 8,109.75 ms, because its render waited out the
// provider's eight-second abort before any byte left. The same build without
// provider keys answered its cold document in 133.91 ms. The document now asks
// no live lane at all. It holds the grounded listings it already has and says
// the live listings have not been checked. The browser read of /api/out is the
// one that asks the live lanes, and its full answer replaces the document's.

import { act, createElement, type ReactElement } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/out",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children?: unknown; href: string; prefetch?: boolean }) => {
    const attrs: Record<string, unknown> = { ...rest };
    delete attrs.prefetch;
    return createElement("a", { href, ...attrs }, children as never);
  },
}));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-vercel-forwarded-for": "192.0.2.135" }),
}));

import OutPage from "@/app/out/page";
import type { HeldOutAnswer } from "@/components/out/useOutListings";
import { OUT_LIVE_LISTINGS_DEFERRED_REASON } from "@/lib/out/loadOut";
import {
  OUT_EMPTY_LINE,
  OUT_NOT_CONFIGURED_LINE,
  OUT_READ_FAILED_LINE,
} from "@/lib/out/outStatus";
import type { OutResponse } from "@/lib/out/types";
import type { WhatsOnRow } from "@/lib/whatsOn";
import { __resetWhatsOnListingStore, whatsOnListingStore } from "@/lib/whatsOnListingStore";

const DOCUMENT_CEILING_MS = 1_500;
// Friday 16 October 2026, 18:00 in London.
const NOW = Date.parse("2026-10-16T17:00:00Z");

// A refreshed listing, written through the same store the refresh writes and
// the document reads, with its own source observation date.
const SERVED_ROW: WhatsOnRow = {
  id: "events-served-fixture",
  kind: "event",
  title: "Served fixture comedy night",
  placeName: "The Fixture Hall",
  startsAt: "2026-10-16T19:30:00Z",
  source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/served-fixture" },
  observedAt: "2026-10-15T12:00:00.000Z",
  confidence: "listed",
  sourceId: "served-fixture",
};

type ProviderStart = { host: string };

let providerStarts: ProviderStart[] = [];
let container: HTMLDivElement | null = null;
let root: Root | null = null;

// The provider boundary the HTTP proof used: record the start, then hold the
// request open until the caller's own abort fires.
function hangingProviderFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  providerStarts.push({ host: url.host });
  return new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });
}

async function renderDocument(day?: string): Promise<ReactElement<{ initialAnswer: HeldOutAnswer }>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`the /out document waited over ${DOCUMENT_CEILING_MS} ms`)),
      DOCUMENT_CEILING_MS,
    );
  });
  try {
    const page = OutPage(day ? { searchParams: Promise.resolve({ day }) } : {});
    return (await Promise.race([page, waited])) as ReactElement<{ initialAnswer: HeldOutAnswer }>;
  } finally {
    clearTimeout(timer);
  }
}

function liveRow(startsAt: string): WhatsOnRow {
  return {
    id: "tm-live-only",
    kind: "event",
    title: "Live provider late show",
    placeName: "The Live Room",
    startsAt,
    source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/live-only" },
    observedAt: startsAt,
    confidence: "listed",
    sourceId: "live-only",
  };
}

function fullApiAnswer(startsAt: string): OutResponse {
  return {
    status: "ready",
    listingsStatus: "ready",
    events: [liveRow(startsAt)],
    openPlans: [
      {
        crewId: "50000000-0000-4000-8000-000000000135",
        title: "Open plan after the show",
        startTime: startsAt,
        stopVenueId: "venue-live-room",
        stopVenueName: "The Live Room",
        hostHandle: "host",
        memberCount: 1,
        meetingPoint: { kind: "venue", name: "The Live Room", lat: 51.5, lng: -0.1 },
      },
    ],
    openPlansStatus: "ready",
    attribution: [
      { label: "Ticketmaster", logoRequired: false, url: "https://www.ticketmaster.co.uk/" },
    ],
    observedAt: { ticketmaster: startsAt },
    providers: [{ name: "ticketmaster", configured: true, rows: 1, status: "ready" }],
    unmatchedCount: 1,
    unmatchedPlaces: ["The Live Room"],
    unmatchedPlaceCount: 1,
    unmatchedSources: ["Ticketmaster"],
    venueMatch: "ready",
  };
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.stubEnv("PUBMAX_E2E_RATE_LIMIT_MAX", "");
  vi.stubEnv("SKIDDLE_API_KEY", "");
  providerStarts = [];
  vi.stubGlobal("fetch", vi.fn(hangingProviderFetch));
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  __resetWhatsOnListingStore();
});

describe("a cold /out document with a configured live provider", () => {
  it("renders grounded listings without starting the provider, then the browser reads the full answer", async () => {
    vi.stubEnv("TICKETMASTER_API_KEY", "disposable-test-key");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    await whatsOnListingStore().replaceKind("event", [SERVED_ROW], SERVED_ROW.observedAt);

    const element = await renderDocument();
    expect(providerStarts).toEqual([]);
    const seed = element.props.initialAnswer;
    expect(seed.servedAt).toBe(NOW);
    expect(seed.body?.observedAt).toEqual({ ticketmaster: SERVED_ROW.observedAt });

    container = document.createElement("div");
    document.body.append(container);
    container.innerHTML = renderToString(element);
    const seeded = container.textContent ?? "";
    expect(seeded).toContain(SERVED_ROW.title);
    expect(seeded).toContain(OUT_LIVE_LISTINGS_DEFERRED_REASON);
    expect(seeded).not.toContain(OUT_EMPTY_LINE);
    expect(seeded).not.toContain(OUT_NOT_CONFIGURED_LINE);
    expect(seeded).not.toContain(OUT_READ_FAILED_LINE);

    const api = fullApiAnswer("2026-10-16T20:30:00Z");
    const browserRead = vi.fn(async () => Response.json(api));
    vi.stubGlobal("fetch", browserRead);
    await act(async () => {
      root = hydrateRoot(container as HTMLDivElement, element);
    });
    await act(async () => {});

    expect(browserRead.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/out?city=london&day=today",
    ]);
    const hydrated = container.textContent ?? "";
    expect(hydrated).toContain("Live provider late show");
    expect(hydrated).toContain("Open plan after the show");
    expect(hydrated).not.toContain(OUT_LIVE_LISTINGS_DEFERRED_REASON);
  });

  it.each([
    ["bare /out", undefined],
    ["Tonight", "tonight"],
    ["Tomorrow", "tomorrow"],
    ["Weekend", "weekend"],
  ])(
    "starts no provider for %s and never words the unasked lane as quiet or switched off",
    async (_label, day) => {
      vi.stubEnv("TICKETMASTER_API_KEY", "disposable-test-key");
      vi.useFakeTimers({ toFake: ["Date"] });
      // Past every bundled listing, so the grounded half is empty and only the
      // unasked live lane is left to describe.
      vi.setSystemTime(Date.parse("2030-01-04T18:00:00Z"));

      const element = await renderDocument(day);
      expect(providerStarts).toEqual([]);
      const seed = element.props.initialAnswer;
      expect(seed.failed).toBe(false);
      expect(seed.body?.events).toEqual([]);
      expect(seed.body?.providers).toContainEqual(
        expect.objectContaining({ name: "ticketmaster", configured: true, status: "deferred" }),
      );

      const html = renderToString(element);
      expect(html).toContain(OUT_LIVE_LISTINGS_DEFERRED_REASON);
      expect(html).not.toContain(OUT_EMPTY_LINE);
      expect(html).not.toContain(OUT_NOT_CONFIGURED_LINE);
    },
  );

  it("keeps the keyless document unchanged: an empty night with no lane configured is still not configured", async () => {
    vi.stubEnv("TICKETMASTER_API_KEY", "");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2030-01-04T18:00:00Z"));

    const element = await renderDocument();
    expect(providerStarts).toEqual([]);
    expect(element.props.initialAnswer.body?.status).toBe("not-configured");
    expect(renderToString(element)).toContain(OUT_NOT_CONFIGURED_LINE);
  });
});
