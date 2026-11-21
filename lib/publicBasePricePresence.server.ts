import "server-only";
import type { PublicPricePresence } from "@/lib/publicPricePresence";
import { lookupUkBasePubs } from "@/lib/ukBaseIndex";
import { loadVenueAliasResolver } from "@/lib/venueAliases";
import { communityPriceStore } from "@/lib/communityPriceStore";
import { pintDropsStore } from "@/lib/pintDropsStore";
import { ukPriceBundleRowsByVenue } from "@/lib/ukPriceBundle.server";
import { readPublicPricePresence } from "@/lib/publicPricePresence.server";
import { venuePriceUpdatesFor } from "@/lib/priceUpdates.server";
import { venueMenuLookupKeys } from "@/lib/venueMenu";
import { parsePriceUpdates } from "@/lib/priceUpdates";
import rawPriceUpdates from "@/public/data/price_updates/latest.json";

const priceUpdates = parsePriceUpdates(rawPriceUpdates);

export async function readPublicBasePricePresence(ids: readonly string[]): Promise<Record<string, PublicPricePresence>> {
  const result = Object.fromEntries(ids.map((id) => [id, "unknown" as PublicPricePresence]));
  try {
    const [pubs, aliases] = await Promise.all([lookupUkBasePubs(ids), loadVenueAliasResolver()]);
    if (aliases.status !== "ready") return result;
    const storedIds = [...new Set(ids.flatMap((id) => aliases.storedIds(id)))];
    const owners = [...new Set([...pubs.values()].flatMap((lookup) => lookup.status === "ready" && lookup.pub.curatedVenueId ? [lookup.pub.curatedVenueId] : []))];
    const [drops, community, bundle, ownerPresence] = await Promise.allSettled([
      Promise.resolve().then(() => pintDropsStore().publicPricedVenueIds(storedIds)),
      Promise.resolve().then(() => communityPriceStore().publicPricedVenueIds(storedIds)),
      ukPriceBundleRowsByVenue(),
      owners.length ? readPublicPricePresence(owners) : Promise.resolve({} as Record<string, PublicPricePresence>),
    ]);
    await Promise.all(ids.map(async (id) => {
      const pub = pubs.get(id);
      if (pub?.status !== "ready") return;
      const keys = aliases.storedIds(id);
      const owner = pub.pub.curatedVenueId;
      const menuKeys = [...keys, ...venueMenuLookupKeys({ id, name: pub.pub.name, sourceName: pub.pub.sourceName, address: pub.pub.address, latitude: pub.pub.lat, longitude: pub.pub.lng, prices: [] })];
      const updates = await venuePriceUpdatesFor(menuKeys).catch(() => null);
      if (keys.some((key) => (drops.status === "fulfilled" && drops.value.has(key)) ||
        (community.status === "fulfilled" && community.value.has(key)) ||
        (bundle.status === "fulfilled" && bundle.value.byVenue.get(key)?.some((row) => row.standing !== "estimate"))) ||
        priceUpdates.some((row) => menuKeys.includes(row.venueKey)) ||
        updates?.drink.some((row) => row.lane !== "demo") ||
        (owner && ownerPresence.status === "fulfilled" && ownerPresence.value[owner] === "present")) {
        result[id] = "present";
      } else if (updates !== null && drops.status === "fulfilled" && community.status === "fulfilled" && bundle.status === "fulfilled" && bundle.value.status !== "unavailable" &&
        (!owner || (ownerPresence.status === "fulfilled" && ownerPresence.value[owner] === "absent"))) {
        result[id] = "absent";
      }
    }));
  } catch {
    return result;
  }
  return result;
}
