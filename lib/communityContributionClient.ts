import {
  accountBoundFetch,
  type AccountAuthSnapshot,
  type AccountBoundRequest,
} from "@/lib/accountBoundFetch";
import type { DrinkCategory } from "@/lib/drinks";
import type {
  CommunityVenueSignalKey,
  CommunityVenueSignalValue,
} from "@/lib/communityVenueSignals";

export type CommunityContributionPayload =
  | Readonly<{
      venueId: string;
      drinkCategory: DrinkCategory;
      priceGbp: number;
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
  request: AccountBoundRequest = fetch,
): Promise<Response> {
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
