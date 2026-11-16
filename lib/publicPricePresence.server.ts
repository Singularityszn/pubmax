import "server-only";

import { communityPriceStore } from "@/lib/communityPriceStore";
import { pintDropsStore } from "@/lib/pintDropsStore";
import { loadVenueAliasResolver } from "@/lib/venueAliases";
import { lookupVenueDetail } from "@/lib/venueDetailIndex";
import { venueMenuLookupKeys } from "@/lib/venueMenu";
import { venuePriceUpdatesFor } from "@/lib/priceUpdates.server";
import { ukPriceBundleRowsByVenue } from "@/lib/ukPriceBundle.server";
import rawPriceUpdates from "@/public/data/price_updates/latest.json";
import { parsePriceUpdates } from "@/lib/priceUpdates";
import type { PublicPricePresence } from "@/lib/publicPricePresence";

export async function readPublicPricePresence(venueIds: readonly string[]): Promise<Record<string, PublicPricePresence>> {
  const result = Object.fromEntries(venueIds.map((id) => [id, "unknown" as PublicPricePresence]));
  try {
    const aliases = await loadVenueAliasResolver();
    if (aliases.status !== "ready") return result;
    const storedIds = [...new Set(venueIds.flatMap((id) => aliases.storedIds(id)))];
    if (!storedIds.length) return result;
    const [drops, community, bundle] = await Promise.allSettled([
      Promise.resolve().then(() => pintDropsStore().publicPricedVenueIds(storedIds)),
      Promise.resolve().then(() => communityPriceStore().publicPricedVenueIds(storedIds)),
      ukPriceBundleRowsByVenue(),
    ]);
    await Promise.all(venueIds.map(async (id) => {
      const keys = aliases.storedIds(id);
      if (keys.some((key) => (drops.status === "fulfilled" && drops.value.has(key))
        || (community.status === "fulfilled" && community.value.has(key))
        || (bundle.status === "fulfilled" && bundle.value.byVenue.get(key)?.some((row) => row.standing !== "estimate")))) {
        result[id] = "present";
        return;
      }
      try {
        const detail = await lookupVenueDetail(aliases.canonical(id));
        if (detail.status !== "found" && detail.status !== "retired") return;
        if (detail.venue.cheapestPrice !== null || detail.venue.prices.some((price) => price.price_gbp !== null)) {
          result[id] = "present";
          return;
        }
        const menuKeys = [...keys, ...venueMenuLookupKeys(detail.venue)];
        if (parsePriceUpdates(rawPriceUpdates).some((row) => menuKeys.includes(row.venueKey))) {
          result[id] = "present";
          return;
        }
        const updates = await venuePriceUpdatesFor(menuKeys);
        if (updates?.drink.some((row) => row.lane !== "demo")) {
          result[id] = "present";
          return;
        }
        if (drops.status === "fulfilled" && community.status === "fulfilled" && updates !== null
          && bundle.status === "fulfilled" && bundle.value.status !== "unavailable") result[id] = "absent";
      } catch {
        // An unread source leaves this pub unknown.
      }
    }));
  } catch {
    return result;
  }
  return result;
}
