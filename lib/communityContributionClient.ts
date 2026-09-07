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
  options?: Readonly<{ pintPhoto?: File | null; receiptPhoto?: File | null }>,
  request: AccountBoundRequest = fetch,
): Promise<Response> {
  // A MULTIPART BODY WHENEVER A PHOTO RIDES. The bill is the one every new
  // price carries (captain 7 Sept 2026, lib/pintDropReceipt.ts) and the pint
  // photo is the optional one beside it; either sends the form.
  if (options?.pintPhoto || options?.receiptPhoto) {
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
    if (options.pintPhoto) form.set("pint_photo", options.pintPhoto);
    if (options.receiptPhoto) form.set("receipt_photo", options.receiptPhoto);
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
