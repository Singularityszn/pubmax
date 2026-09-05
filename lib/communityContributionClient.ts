import {
  accountBoundFetch,
  type AccountAuthSnapshot,
  type AccountBoundRequest,
} from "@/lib/accountBoundFetch";
import type { DrinkCategory } from "@/lib/drinks";
import type { DrinkMeasure } from "@/lib/drinkMeasure";
import type {
  CommunityVenueSignalKey,
  CommunityVenueSignalValue,
} from "@/lib/communityVenueSignals";

type CommunityContributionPayload =
  | Readonly<{
      venueId: string;
      drinkCategory: DrinkCategory;
      priceGbp: number;
      /**
       * WHAT SERVING THE FIGURE IS ABOUT (review finding F-2). Sent on the beer
       * lane, where the composer asks it; absent everywhere else, and an absent
       * measure reads as `pint` server-side exactly as it always did.
       */
      measure?: DrinkMeasure;
      measureLabel?: string;
    }>
  | Readonly<{
      kind: "venue-signal";
      venueId: string;
      signalKey: CommunityVenueSignalKey;
      signalValue: CommunityVenueSignalValue;
    }>;

export function postCommunityContribution(
  auth: AccountAuthSnapshot,
  payload: CommunityContributionPayload,
  options?: Readonly<{ pintPhoto?: File | null }>,
  request: AccountBoundRequest = fetch,
): Promise<Response> {
  if (options?.pintPhoto) {
    const form = new FormData();
    if ("kind" in payload) {
      form.set("kind", payload.kind);
      form.set("venueId", payload.venueId);
      form.set("signalKey", payload.signalKey);
      form.set("signalValue", payload.signalValue);
    } else {
      form.set("venueId", payload.venueId);
      form.set("drinkCategory", payload.drinkCategory);
      form.set("priceGbp", String(payload.priceGbp));
      if (payload.measure) form.set("measure", payload.measure);
      if (payload.measureLabel) form.set("measureLabel", payload.measureLabel);
    }
    form.set("pint_photo", options.pintPhoto);
    return accountBoundFetch(
      auth,
      "/api/price-submit",
      { method: "POST", body: form },
      request,
    );
  }
  return accountBoundFetch(
    auth,
    "/api/price-submit",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
    request,
  );
}
