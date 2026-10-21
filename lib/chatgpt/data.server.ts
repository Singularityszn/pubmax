import "server-only";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { lookupVenueDetail } from "@/lib/venueDetailIndex";
import { legacyPintPriceObservedAt, namedLegacyPintPriceSource } from "@/lib/drinks";
import { PRICE_AUTHORITY_MAX_AGE_MS } from "@/lib/priceAuthorityWindow";
import { venueMapUrl } from "@/lib/venueMapUrl";
import { retrieveHeritageWithStatus } from "@/lib/heritage";
import { nightAreaForMapQuery } from "@/lib/nightAreas";
import { haversineKm } from "@/lib/haversine";
import { sanitizeHeritageFacts } from "@/lib/heritageFacts";
import { NightArchitectError, type PublicPub } from "@/lib/chatgpt/server";

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && url.href.length <= 2048 ? url.href : null;
  } catch { return null; }
}

export async function publicPubDetails(id: string, includeHistory: boolean): Promise<PublicPub | null> {
  const index = await loadConciergeVenues("london");
  if (!index.length) throw new NightArchitectError("Pub records could not be read. Try again shortly.", true);
  if (!index.some((pub) => pub.id === id)) return null;
  const detail = await lookupVenueDetail(id);
  if (detail.status === "unavailable") throw new NightArchitectError("Pub records could not be read. Try again shortly.", true);
  if (detail.status !== "found") return null;
  const pub = detail.venue;
  const now = Date.now();
  const prices: PublicPub["prices"] = pub.prices
    .filter((price) => typeof price.price_gbp === "number" && Number.isFinite(price.price_gbp) && price.price_gbp > 0)
    .slice(0, 3).map((price) => {
      const source = namedLegacyPintPriceSource(price);
      const observedAt = legacyPintPriceObservedAt(price);
      const time = observedAt ? Date.parse(observedAt) : NaN;
      return {
        drink: (price.pint_name || "Pint").slice(0, 160), priceGbp: price.price_gbp as number,
        observedAt, status: Number.isFinite(time) && time <= now && now - time <= PRICE_AUTHORITY_MAX_AGE_MS ? "recorded" : "estimate",
        publisher: source ? { label: source.label.slice(0, 160), url: httpsUrl(source.url) } : null,
      };
    });
  let history: PublicPub["history"] = [];
  if (includeHistory) {
    try {
      const read = await retrieveHeritageWithStatus({ venueId: id, venueName: pub.name });
      history = sanitizeHeritageFacts(read.facts).flatMap((fact) => {
        const sourceRef = httpsUrl(fact.sourceRef);
        return sourceRef ? [{ fact: fact.fact.slice(0, 1000), sourceRef, ...(fact.observedAt ? { observedAt: fact.observedAt } : {}) }] : [];
      }).slice(0, 6);
    } catch { /* An unavailable story must retain the pub and its price evidence. */ }
  }
  return {
    id: pub.id, name: pub.name.slice(0, 160), area: pub.primaryBorough,
    latitude: pub.latitude, longitude: pub.longitude,
    href: new URL(venueMapUrl(pub.id), "https://pubmaxxing.com").href,
    prices, history,
  };
}

export async function searchPublicPubs(query: string, limit: number): Promise<PublicPub[]> {
  const index = await loadConciergeVenues("london");
  if (!index.length) throw new NightArchitectError("Pub records could not be read. Try again shortly.", true);
  const normalized = query.trim().toLocaleLowerCase("en-GB");
  const district = nightAreaForMapQuery("london", query);
  const candidates = index.filter((pub) => pub.name.toLocaleLowerCase("en-GB").includes(normalized)
    || pub.area.toLocaleLowerCase("en-GB").includes(normalized)
    || (district && haversineKm([pub.lng, pub.lat], [district.centre.lng, district.centre.lat]) <= district.radiusKm))
    .sort((left, right) => district
      ? haversineKm([left.lng, left.lat], [district.centre.lng, district.centre.lat]) - haversineKm([right.lng, right.lat], [district.centre.lng, district.centre.lat])
      : left.name.localeCompare(right.name, "en-GB"));
  // Inspect a bounded extra set so a retired record does not consume a result slot.
  const pubs = await Promise.all(candidates.slice(0, limit * 2).map((pub) => publicPubDetails(pub.id, false)));
  return pubs.filter((pub): pub is PublicPub => pub !== null).slice(0, limit);
}
