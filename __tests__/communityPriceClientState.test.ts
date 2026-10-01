// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useCommunityPrices } from "@/components/map/useCommunityPrices";
import UnverifiedPubSheet from "@/components/map/UnverifiedPubSheet";
import type { UkBasePub } from "@/lib/ukBasePubs";
import { DRINK_CATEGORIES } from "@/lib/drinks";

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: null, handle: null, identityResolved: true, loading: false, configured: true }),
}));

import {
  planProvisionalBaseVenueRead,
  provisionalBaseBackoffMs,
  PROVISIONAL_BASE_BACKOFF_MS,
  readCategoryPriceIndexLoad,
  readCommunityPriceAttribution,
  readProvisionalVenueIdsLoad,
  rejectedCommunitySubmission,
  readVenueSignalLoad,
  readVenuePriceLoad,
  rollbackOptimisticPrice,
  rollbackOptimisticVenueSignal,
} from "@/components/map/useCommunityPrices";
import type { CommunityPrice } from "@/lib/communityPrice";
import type { CommunityVenueSignal } from "@/lib/communityVenueSignals";

const storedBeer: CommunityPrice = {
  venueId: "venue-uk-n123",
  drinkCategory: "beer",
  priceGbp: 4.6,
  submittedAt: 2_000,
  source: "community",
  corroborations: 1,
};

const optimisticBeer: CommunityPrice = {
  venueId: "venue-uk-n123",
  drinkCategory: "beer",
  priceGbp: 5.2,
  submittedAt: 3_000,
  source: "community",
  corroborations: 1,
};

// The durable limiter records a hit even when it refuses one, so a client that
// cannot tell 429 from a dropped connection retries into its own lockout and
// never gets a base mark again for the rest of the session.
describe("provisionalBaseBackoffMs", () => {
  it("keeps a transient failure retryable and only stands down on a refusal", () => {
    expect(provisionalBaseBackoffMs(200, null)).toBeNull();
    expect(provisionalBaseBackoffMs(500, null)).toBeNull();
    expect(provisionalBaseBackoffMs(503, "30")).toBeNull();
    expect(provisionalBaseBackoffMs(429, null)).toBe(PROVISIONAL_BASE_BACKOFF_MS);
  });

  it("respects Retry-After as seconds or as a date", () => {
    const now = Date.UTC(2026, 6, 28, 21, 0, 0);
    expect(provisionalBaseBackoffMs(429, "30", now)).toBe(30_000);
    expect(
      provisionalBaseBackoffMs(429, new Date(now + 45_000).toUTCString(), now),
    ).toBe(45_000);
  });

  it("bounds a header it cannot use, in both directions", () => {
    const now = Date.UTC(2026, 6, 28, 21, 0, 0);
    // Never busy-retry: a zero or past deadline still costs a real pause.
    expect(provisionalBaseBackoffMs(429, "0", now)).toBe(1_000);
    expect(
      provisionalBaseBackoffMs(429, new Date(now - 60_000).toUTCString(), now),
    ).toBe(1_000);
    // …and never mute the layer for the session on one server's say-so.
    expect(provisionalBaseBackoffMs(429, "99999", now)).toBe(300_000);
    // Unparseable falls back to the window we know the server runs.
    expect(provisionalBaseBackoffMs(429, "soon", now)).toBe(
      PROVISIONAL_BASE_BACKOFF_MS,
    );
    expect(provisionalBaseBackoffMs(429, "  ", now)).toBe(
      PROVISIONAL_BASE_BACKOFF_MS,
    );
  });
});

describe("community price client state", () => {
  it("preserves write-time authentication expiry for the contribution gate", () => {
    expect(
      rejectedCommunitySubmission(401, "Sign in.", "Could not log."),
    ).toEqual({
      ok: false,
      error: "Sign in.",
      reason: "rejected",
      status: "sign_in_required",
    });
    expect(
      rejectedCommunitySubmission(503, undefined, "Could not log."),
    ).toEqual({
      ok: false,
      error: "Could not log.",
      reason: "rejected",
    });
    expect(
      rejectedCommunitySubmission(
        409,
        "Finish setup.",
        "Could not log.",
        "onboarding_required",
      ),
    ).toEqual({
      ok: false,
      error: "Finish setup.",
      reason: "rejected",
      status: "onboarding_required",
    });
    expect(
      rejectedCommunitySubmission(
        403,
        "Rejected.",
        "Could not log.",
        "age_restricted",
      ),
    ).toEqual({
      ok: false,
      error: "Rejected.",
      reason: "rejected",
    });
  });

  it("trusts only a server-confirmed contributor attribution", () => {
    expect(
      readCommunityPriceAttribution({
        status: "credited",
        handle: "@Night_Owl",
      }),
    ).toEqual({ status: "credited", handle: "night_owl" });
    expect(
      readCommunityPriceAttribution({
        status: "credited",
        handle: "",
      }),
    ).toEqual({ status: "anonymous" });
    expect(readCommunityPriceAttribution(null)).toEqual({
      status: "anonymous",
    });
  });

  it("reads only newly visible stable base ids", () => {
    expect(
      planProvisionalBaseVenueRead(
        [
          "venue-uk-w2",
          "venue-curated",
          "venue-uk-n1",
          "venue-uk-w2",
          "venue-uk-n3",
        ],
        new Set(["venue-uk-n1", "venue-uk-n3"]),
      ),
    ).toEqual({
      visible: ["venue-uk-n1", "venue-uk-n3", "venue-uk-w2"],
      unread: ["venue-uk-w2"],
    });
  });

  it("accepts only stable base ids from a provisional viewport response", () => {
    expect(
      readProvisionalVenueIdsLoad({
        venueIds: [
          "venue-uk-n123",
          "venue-curated",
          "",
          "venue-uk-n456",
          "venue-uk-n999",
        ],
      },
        new Set(["venue-uk-n123", "venue-uk-n456"]),
      ),
    ).toEqual({
      status: "ready",
      venueIds: ["venue-uk-n123", "venue-uk-n456"],
    });
    expect(
      readProvisionalVenueIdsLoad(
        {
          venueIds: [],
          degraded: true,
        },
        new Set(),
      ),
    ).toEqual({ status: "degraded", venueIds: [] });
    expect(readProvisionalVenueIdsLoad({ venueIds: "bad" }, new Set())).toEqual({
      status: "invalid",
      venueIds: [],
    });
  });

  it("distinguishes an honest empty lens index from a degraded one", () => {
    expect(readCategoryPriceIndexLoad({ prices: [], truncated: false })).toEqual({
      status: "ready",
      prices: [],
      truncated: false,
    });
    expect(
      readCategoryPriceIndexLoad({
        prices: [],
        truncated: false,
        degraded: true,
      }),
    ).toEqual({
      status: "degraded",
      prices: [],
      truncated: false,
    });
    expect(readCategoryPriceIndexLoad({ prices: "bad" })).toEqual({
      status: "invalid",
      prices: [],
      truncated: false,
    });
  });
  it("keeps a degraded empty read unknown instead of confirming no price", () => {
    expect(readVenuePriceLoad({ prices: [], degraded: true })).toEqual({
      status: "degraded",
      prices: [],
    });
    expect(readVenuePriceLoad({ prices: [] })).toEqual({
      status: "ready",
      prices: [],
    });
  });

  it("rolls back only its optimistic row after a concurrent read", () => {
    const storedWine: CommunityPrice = {
      venueId: "venue-uk-n123",
      drinkCategory: "wine",
      priceGbp: 8.5,
      submittedAt: 2_500,
      source: "community",
      corroborations: 1,
    };

    expect(
      rollbackOptimisticPrice(
        [optimisticBeer, storedWine],
        optimisticBeer,
        [storedBeer, storedWine],
        true,
      ),
    ).toEqual([storedWine, storedBeer]);
  });
});

describe("community venue signal client state", () => {
  const stored: CommunityVenueSignal = {
    venueId: "venue-xjf3n0",
    signalKey: "step-free-venue",
    signalValue: "steps",
    submittedAt: 2_000,
    source: "community",
    corroborations: 1,
    establishedCandidate: {
      signalValue: "step-free",
      submittedAt: 1_000,
      corroborations: 2,
    },
  };

  const optimistic: CommunityVenueSignal = {
    venueId: "venue-xjf3n0",
    signalKey: "step-free-venue",
    signalValue: "step-free",
    submittedAt: 3_000,
    source: "community",
    corroborations: 1,
  };

  it("narrows a combined venue response without trusting malformed signal rows", () => {
    expect(
      readVenueSignalLoad({
        signals: [
          stored,
          {
            ...stored,
            signalKey: "music",
            signalValue: "loud",
          },
        ],
      }),
    ).toEqual({
      status: "ready",
      signals: [stored],
    });
  });

  it("distinguishes an honest empty signal read from a failed read", () => {
    expect(readVenueSignalLoad({ signals: [] })).toEqual({
      status: "ready",
      signals: [],
    });
    expect(
      readVenueSignalLoad({ signals: [], degraded: true }),
    ).toEqual({
      status: "degraded",
      signals: [],
    });
    // A payload with no `signals` key is an older deployment answering about
    // prices alone, not an unreadable one: calling it invalid dropped that
    // venue's perfectly good prices for the whole session.
    expect(readVenueSignalLoad({ prices: [] })).toEqual({
      status: "ready",
      signals: [],
    });
    expect(readVenueSignalLoad({ signals: "soon" })).toEqual({
      status: "invalid",
      signals: [],
    });
    expect(readVenueSignalLoad({ signals: [{ signalKey: "music" }] })).toEqual({
      status: "invalid",
      signals: [],
    });
  });

  it("keeps the observation id a reader can flag", () => {
    expect(
      readVenueSignalLoad({ signals: [{ ...stored, id: "obs-1" }] }),
    ).toEqual({
      status: "ready",
      signals: [{ ...stored, id: "obs-1" }],
    });
  });

  it("rolls back only the optimistic answer after a rejected write", () => {
    expect(
      rollbackOptimisticVenueSignal(
        [optimistic],
        optimistic,
        [stored],
        true,
      ),
    ).toEqual([stored]);
  });
});


describe("published menu prices through the selected base read", () => {
  const pub: UkBasePub = { id: "venue-uk-n123", name: "Test Arms", address: "", lat: 51.49, lng: -0.17, curatedVenueId: "", kind: "pub" };
  const quote = {
    source: "listed", category: "wine", drinkLabel: "Rioja, Spain", priceGbp: 10.5,
    servingSize: "250ml", sourceUrl: "https://pub.example/menu", observedAt: "2026-09-29T10:40:17.846Z",
  };
  let root: Root | null = null;
  let restoreClock = () => {};
  let container: HTMLDivElement;
  let current: ReturnType<typeof useCommunityPrices>;
  function Surface({ selected }: { selected: UkBasePub }) {
    const communityPrices = useCommunityPrices();
    current = communityPrices;
    const loadVenue = communityPrices.loadVenue;
    // Same selected read as VenuePriceEntryPanel; dedupe must absorb both callers.
    useEffect(() => { loadVenue(selected.id); }, [loadVenue, selected.id]);
    return createElement(UnverifiedPubSheet, { pub: selected, communityPrices });
  }
  function mount(selected = pub) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    root.render(createElement(Surface, { selected }));
  }
  function mockPriceReads(read: (id: string) => Promise<Response> | Response) {
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/price-submit") return read(url.searchParams.get("venueId") ?? "");
      return Promise.resolve(Response.json({ status: "ready", overlay: null }));
    });
    vi.stubGlobal("fetch", fetcher);
    return fetcher;
  }
  beforeEach(() => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-30T00:00:00Z"));
    restoreClock = () => clock.mockRestore();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    root = null;
    container?.remove();
    vi.unstubAllGlobals();
    restoreClock();
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it("uses the existing selected GET and keeps published rows out of community map authority", async () => {
    const fetcher = mockPriceReads(() => Response.json({ prices: [], signals: [], listedPrices: [quote] }));
    await act(async () => { mount(); });
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(container.textContent).toContain("Rioja, Spain");
    });
    expect(container.textContent).toContain("250ml");
    expect(current.byVenueId.get(pub.id)).toEqual([]);
    expect(current.freshestByVenueId.has(pub.id)).toBe(false);
    expect(current.venuePriceStatus.get(pub.id)).toBe("ready");
    expect(fetcher.mock.calls.filter(([input]) => String(input).startsWith("/api/price-submit?venueId="))).toHaveLength(1);
  });

  it("renders an unknown-serving listed beer without community price authority or a second GET", async () => {
    const beer = { ...quote, category: "beer", drinkLabel: null, priceGbp: 4.9, servingSize: null,
      sourceUrl: "https://donardbar.co.uk/menus/", observedAt: "2026-09-04T10:00:00Z" };
    const fetcher = mockPriceReads(() => Response.json({ prices: [], signals: [], listedPrices: [beer] }));
    await act(async () => { mount(); });
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(container.textContent).toContain("£4.90");
    });
    expect(container.textContent).toContain("Serving not recorded");
    expect(container.textContent).not.toContain("No price yet");
    expect(current.listedPricesByVenueId?.get(pub.id)).toEqual([beer]);
    expect(current.byVenueId.get(pub.id)).toEqual([]);
    expect(current.freshestByVenueId.has(pub.id)).toBe(false);
    expect(fetcher.mock.calls.filter(([input]) => String(input).startsWith("/api/price-submit?venueId="))).toHaveLength(1);
  });

  it("accepts the bounded four quotes in every category, including neutral beer", async () => {
    const listedPrices = DRINK_CATEGORIES.flatMap(category => Array.from({ length: 4 }, (_, index) => ({
      ...quote, category, drinkLabel: `Drink ${category} ${index}`, servingSize: null,
    })));
    mockPriceReads(() => Response.json({ prices: [], signals: [], listedPrices }));
    await act(async () => { mount(); });
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(current.listedPricesByVenueId?.get(pub.id)).toEqual(listedPrices);
    });
    expect(container.textContent).not.toContain("Published menu prices unavailable just now");
    expect(current.byVenueId.get(pub.id)).toEqual([]);
  });

  it.each([
    { ...quote, source: "estimate" },
    { ...quote, sourceUrl: "javascript:alert(1)" },
    { ...quote, observedAt: "not-a-date" },
    { ...quote, observedAt: "2024-01-01T00:00:00.000Z" },
    { ...quote, servingSize: 250 },
    { ...quote, drinkLabel: {} },
    { ...quote, drinkLabel: "x".repeat(81) },
    { ...quote, servingSize: "x".repeat(49) },
    { ...quote, sourceUrl: `https://pub.example/${"x".repeat(2048)}` },
  ])("does not render a malformed or expired published claim: %j", async (invalid) => {
    mockPriceReads(() => Response.json({ prices: [], signals: [], listedPrices: [invalid] }));
    await act(async () => { mount(); });
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(container.textContent).toContain("Published menu prices unavailable just now");
    });
    expect(container.textContent).not.toContain("£10.50");
    expect(current.venuePriceStatus.get(pub.id)).toBe("ready");
  });

  it("uses canonical label normalization without changing the quoted measure or amount", async () => {
    mockPriceReads(() => Response.json({ prices: [], signals: [], listedPrices: [
      { ...quote, drinkLabel: "  Rioja, Spain  " },
      { ...quote, drinkLabel: "   ", priceGbp: 5.25, servingSize: "125ml" },
    ] }));
    await act(async () => { mount(); });
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(container.textContent).toContain("Rioja, Spain");
    });
    expect(current.listedPricesByVenueId?.get(pub.id)).toEqual([
      { ...quote, drinkLabel: "Rioja, Spain" },
      { ...quote, drinkLabel: null, priceGbp: 5.25, servingSize: "125ml" },
    ]);
    expect(container.textContent).toContain("250ml");
    expect(container.textContent).toContain("125ml");
  });

  it("rejects overfull serving quote groups without changing the community read", async () => {
    mockPriceReads(() => Response.json({ prices: [], signals: [], listedPrices: Array.from({ length: 5 }, () => quote) }));
    await act(async () => { mount(); });
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(container.textContent).toContain("Published menu prices unavailable just now");
    });
    expect(current.venuePriceStatus.get(pub.id)).toBe("ready");
    expect(container.textContent).not.toContain("£10.50");
  });

  it("allows a failed published read to retry without changing community availability", async () => {
    let attempt = 0;
    mockPriceReads(() => Response.json({ prices: [], signals: [], listedPrices: attempt++ === 0 ? null : [quote] }));
    await act(async () => { mount(); });
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(container.textContent).toContain("Published menu prices unavailable just now");
    });
    expect(current.venuePriceStatus.get(pub.id)).toBe("ready");
    await act(async () => { current.loadVenue(pub.id); });
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(container.textContent).toContain("Rioja, Spain");
    });
    expect(attempt).toBe(2);
  });

  it("keeps a late A response attached to A after the selected base pub changes to B", async () => {
    let finishA!: (response: Response) => void;
    const responseA = new Promise<Response>((resolve) => { finishA = resolve; });
    const second = { ...pub, id: "venue-uk-n456", name: "Second Arms" };
    mockPriceReads((id) => id === pub.id ? responseA : Response.json({ prices: [], signals: [], listedPrices: [{ ...quote, drinkLabel: "Chardonnay", priceGbp: 8 }] }));
    await act(async () => { mount(); });
    await act(async () => { root!.render(createElement(Surface, { selected: second })); });
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(container.textContent).toContain("Chardonnay");
    });
    await act(async () => { finishA(Response.json({ prices: [], signals: [], listedPrices: [quote] })); });
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(current.listedPricesByVenueId?.get(pub.id)).toHaveLength(1);
    });
    expect(container.textContent).toContain("Second Arms");
    expect(container.textContent).toContain("Chardonnay");
    expect(container.textContent).not.toContain("Rioja, Spain");
    expect(container.textContent).not.toContain("£10.50");
  });
});
