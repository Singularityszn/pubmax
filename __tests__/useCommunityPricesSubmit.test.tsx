// @vitest-environment jsdom

import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const postCommunityContribution = vi.hoisted(() => vi.fn());

vi.mock("@/lib/communityContributionClient", () => ({
  postCommunityContribution,
}));

import {
  useCommunityPrices,
  type CommunityPriceSubmitResult,
  type CommunityPricesState,
} from "@/components/map/useCommunityPrices";

let container: HTMLDivElement;
let root: Root;
let prices: CommunityPricesState;

function Harness({
  onState,
}: {
  onState: (state: CommunityPricesState) => void;
}) {
  const state = useCommunityPrices();
  useEffect(() => onState(state), [onState, state]);
  return createElement("output", null, String(state.byVenueId.size));
}

const captureState = (state: CommunityPricesState) => {
  prices = state;
};

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  postCommunityContribution.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Harness, { onState: captureState }));
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

describe("useCommunityPrices submit response boundary", () => {
  it("adopts a matching authoritative price", async () => {
    const authoritative = {
      id: "price-1",
      venueId: "venue-1",
      drinkCategory: "beer" as const,
      priceGbp: 5.2,
      submittedAt: Date.parse("2026-08-31T18:00:00.000Z"),
      source: "community" as const,
      corroborations: 2,
    };
    postCommunityContribution.mockResolvedValue(
      Response.json(
        {
          price: authoritative,
          attribution: { status: "credited", handle: "alice" },
        },
        { status: 201 },
      ),
    );

    let result: CommunityPriceSubmitResult | undefined;
    await act(async () => {
      result = await prices.submit(
        { venueId: "venue-1", drinkCategory: "beer", priceGbp: "5.20" },
        { userId: "user-1", accessToken: "test-access-token" },
      );
    });

    expect(result).toEqual({
      ok: true,
      price: authoritative,
      attribution: { status: "credited", handle: "alice" },
    });
    expect(prices.byVenueId.get("venue-1")).toEqual([authoritative]);
  });

  it("adopts a canonical price when the response proves the requested alias", async () => {
    const authoritative = {
      id: "price-2",
      venueId: "venue-canonical",
      drinkCategory: "beer" as const,
      priceGbp: 5.2,
      submittedAt: Date.parse("2026-08-31T18:00:00.000Z"),
      source: "community" as const,
      corroborations: 1,
    };
    postCommunityContribution.mockResolvedValue(
      Response.json(
        {
          price: authoritative,
          writeTarget: {
            requestedVenueId: "venue-legacy",
            canonicalVenueId: "venue-canonical",
          },
          attribution: { status: "credited", handle: "alice" },
        },
        { status: 201 },
      ),
    );

    let result: CommunityPriceSubmitResult | undefined;
    await act(async () => {
      result = await prices.submit(
        { venueId: "venue-legacy", drinkCategory: "beer", priceGbp: "5.20" },
        { userId: "user-1", accessToken: "test-access-token" },
      );
    });

    expect(result).toEqual({
      ok: true,
      price: authoritative,
      attribution: { status: "credited", handle: "alice" },
    });
    expect(prices.byVenueId.get("venue-legacy")).toEqual([authoritative]);
  });

  it("rejects a direct candidate when a present write target contradicts it", async () => {
    postCommunityContribution.mockResolvedValue(
      Response.json(
        {
          price: {
            id: "price-contradiction",
            venueId: "venue-1",
            drinkCategory: "beer",
            priceGbp: 5.2,
            submittedAt: Date.parse("2026-08-31T18:00:00.000Z"),
            source: "community",
            corroborations: 1,
          },
          writeTarget: {
            requestedVenueId: "venue-1",
            canonicalVenueId: "venue-other",
          },
          attribution: { status: "credited", handle: "alice" },
        },
        { status: 201 },
      ),
    );

    let result: CommunityPriceSubmitResult | undefined;
    await act(async () => {
      result = await prices.submit(
        { venueId: "venue-1", drinkCategory: "beer", priceGbp: "5.20" },
        { userId: "user-1", accessToken: "test-access-token" },
      );
    });

    expect(result).toEqual({
      ok: false,
      error: "Could not confirm that price. It may still be logged.",
      reason: "rejected",
    });
    expect(prices.byVenueId.has("venue-1")).toBe(false);
  });

  it.each([
    [
      "canonical Venue",
      {
        requestedVenueId: "venue-legacy",
        canonicalVenueId: "venue-other",
      },
    ],
    [
      "requested Venue",
      {
        requestedVenueId: "venue-other",
        canonicalVenueId: "venue-canonical",
      },
    ],
  ] as const)(
    "rejects an alias proof with a different %s",
    async (_difference, writeTarget) => {
      postCommunityContribution.mockResolvedValue(
        Response.json(
          {
            price: {
              id: "price-2",
              venueId: "venue-canonical",
              drinkCategory: "beer",
              priceGbp: 5.2,
              submittedAt: Date.parse("2026-08-31T18:00:00.000Z"),
              source: "community",
              corroborations: 1,
            },
            writeTarget,
            attribution: { status: "credited", handle: "alice" },
          },
          { status: 201 },
        ),
      );

      let result: CommunityPriceSubmitResult | undefined;
      await act(async () => {
        result = await prices.submit(
          { venueId: "venue-legacy", drinkCategory: "beer", priceGbp: "5.20" },
          { userId: "user-1", accessToken: "test-access-token" },
        );
      });

      expect(result).toEqual({
        ok: false,
        error: "Could not confirm that price. It may still be logged.",
        reason: "rejected",
      });
      expect(prices.byVenueId.has("venue-legacy")).toBe(false);
    },
  );

  it("rejects a malformed 2xx price response and removes its optimistic row", async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    postCommunityContribution.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      }),
    );

    let resultPromise: Promise<CommunityPriceSubmitResult> | undefined;
    await act(async () => {
      resultPromise = prices.submit(
        { venueId: "venue-1", drinkCategory: "beer", priceGbp: "5.20" },
        { userId: "user-1", accessToken: "test-access-token" },
      );
      await Promise.resolve();
    });

    expect(prices.byVenueId.get("venue-1")).toEqual([
      expect.objectContaining({
        venueId: "venue-1",
        drinkCategory: "beer",
        priceGbp: 5.2,
        source: "community",
        corroborations: 1,
      }),
    ]);

    if (!resolveResponse || !resultPromise) throw new Error("submit did not start");
    const completeResponse = resolveResponse;
    let result: CommunityPriceSubmitResult | undefined;
    await act(async () => {
      completeResponse(
        Response.json(
          { attribution: { status: "credited", handle: "alice" } },
          { status: 201 },
        ),
      );
      result = await resultPromise;
    });

    expect(result).toEqual({
      ok: false,
      error: "Could not confirm that price. It may still be logged.",
      reason: "rejected",
    });
    expect(prices.byVenueId.has("venue-1")).toBe(false);
  });

  it.each([
    ["venue", { venueId: "venue-2" }],
    ["drink", { drinkCategory: "wine" }],
    ["penny value", { priceGbp: 5.21 }],
    ["sub-penny value", { priceGbp: 5.204 }],
  ] as const)(
    "rejects an otherwise valid 2xx row for a different submitted %s",
    async (_difference, override) => {
      postCommunityContribution.mockResolvedValue(
        Response.json(
          {
            price: {
              id: "price-1",
              venueId: "venue-1",
              drinkCategory: "beer",
              priceGbp: 5.2,
              submittedAt: Date.parse("2026-08-31T18:00:00.000Z"),
              source: "community",
              corroborations: 1,
              ...override,
            },
            attribution: { status: "credited", handle: "alice" },
          },
          { status: 201 },
        ),
      );

      let result: CommunityPriceSubmitResult | undefined;
      await act(async () => {
        result = await prices.submit(
          { venueId: "venue-1", drinkCategory: "beer", priceGbp: "5.20" },
          { userId: "user-1", accessToken: "test-access-token" },
        );
      });

      expect(result).toEqual({
        ok: false,
        error: "Could not confirm that price. It may still be logged.",
        reason: "rejected",
      });
      expect(prices.byVenueId.has("venue-1")).toBe(false);
    },
  );
});
