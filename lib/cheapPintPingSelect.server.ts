import "server-only";

import {
  composeCheapPintPing,
  type CheapPintPingPayload,
} from "@/lib/cheapPintPing";
import { getNightArea, type NightAreaSlug } from "@/lib/nightAreas";
import { rankNearMe, venueToPricedPoint } from "@/lib/nearMeAnswer";
import { nightProfileStore } from "@/lib/nightProfileStore";
import { accountIdForOwnerActor } from "@/lib/stepOutNudgeSelect.server";
import { getPricedVenues } from "@/lib/venuePriceIndex";
import type { Venue } from "@/lib/venues";

export type CheapPintPingSelectDeps = {
  nightAreaForAccount: (accountId: string) => Promise<NightAreaSlug | null>;
  listPricedVenues: () => Promise<Venue[]>;
};

function defaultCheapPintPingSelectDeps(): CheapPintPingSelectDeps {
  return {
    nightAreaForAccount: async (accountId) => {
      try {
        const profile = await nightProfileStore().get(accountId);
        return profile?.context.nightArea ?? null;
      } catch {
        return null;
      }
    },
    listPricedVenues: () => getPricedVenues().catch(() => []),
  };
}

/**
 * Grounded cheap pint for one account: night-area centre, listed cheapestPrice
 * only — never community or invented figures.
 */
export async function selectCheapPintPing(
  ownerActor: string,
  accountId: string,
  deps: CheapPintPingSelectDeps = defaultCheapPintPingSelectDeps(),
): Promise<CheapPintPingPayload | null> {
  const areaSlug = await deps.nightAreaForAccount(accountId);
  if (!areaSlug) return null;
  const area = getNightArea(areaSlug);
  if (!area) return null;

  const venues = await deps.listPricedVenues();
  const answer = rankNearMe(area.centre.lat, area.centre.lng, venues.map(venueToPricedPoint), {
    minAnswers: 1,
    maxAnswers: 1,
  });
  const card = answer.cards[0];
  if (!card) return null;

  return composeCheapPintPing({
    venueName: card.name,
    priceGbp: card.cheapestPrice,
    venueId: card.id,
    walkMinutes: card.walkMinutes ?? 1,
    areaName: area.name,
  });
}

export { accountIdForOwnerActor };
