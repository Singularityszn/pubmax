import { describe, expect, it, vi } from "vitest";

import { postCommunityContribution } from "@/lib/communityContributionClient";

describe("community contribution client", () => {
  it.each([
    {
      payload: {
        venueId: "venue-1",
        drinkCategory: "beer" as const,
        priceGbp: 5.8,
      },
    },
    {
      payload: {
        kind: "venue-signal" as const,
        venueId: "venue-1",
        signalKey: "character" as const,
        signalValue: "rough" as const,
      },
    },
  ])("posts each observation with its captured account token", async ({ payload }) => {
    const request = vi.fn().mockResolvedValue(new Response("ok"));

    await postCommunityContribution(
      { userId: "user-a", accessToken: "token-a" },
      payload,
      request,
    );

    expect(request).toHaveBeenCalledWith(
      "/api/price-submit",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(payload),
        headers: expect.any(Headers),
      }),
    );
    const headers = new Headers(request.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer token-a");
  });
});
