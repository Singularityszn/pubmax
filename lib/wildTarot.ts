import { pintRoulettePool, type PintRouletteOptions, type PintRoulettePoint } from "./pintRoulette";

export type PubTarotCard = { id: string; name: string; borough: string; walkMinutes: number; fact: string; sourceUrl: string };
export type PubTarotDraw = { cards: PubTarotCard[]; poolSize: number };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** A malformed asset is a failed read, rather than an empty local pool. */
export function pubTarotListings(value: unknown): Record<string, unknown> {
  const listings = record(record(value)?.listings);
  if (!listings) throw new Error("Heritage listings unavailable");
  return listings;
}

function heritageFact(value: unknown): { fact: string; sourceUrl: string } | null {
  const row = record(value);
  if (!row || typeof row.fact !== "string" || typeof row.url !== "string") return null;
  const fact = row.fact.replace(/\s+/g, " ").trim();
  if (!fact || fact.length > 400 || !Number.isSafeInteger(row.listEntry)) return null;
  try {
    const url = new URL(row.url);
    if (url.protocol !== "https:" || url.hostname !== "historicengland.org.uk" || url.port
      || url.username || url.password || url.search || url.hash
      || !/^\/listing\/the-list\/list-entry\/\d{7}\/?$/.test(url.pathname)
      || url.pathname.replace(/\/$/, "").split("/").at(-1) !== String(row.listEntry)) return null;
    return { fact, sourceUrl: url.href };
  } catch { return null; }
}

/** The existing roulette owns eligibility. Tarot adds each pub's own citation. */
export function drawPubTarot(
  lat: number,
  lng: number,
  venues: readonly PintRoulettePoint[],
  heritage: unknown,
  options: PintRouletteOptions,
): PubTarotDraw | null {
  const listings = pubTarotListings(heritage);
  const pool = pintRoulettePool(lat, lng, venues, options).flatMap(({ point, walkMinutes }) => {
    const fact = heritageFact(Object.hasOwn(listings, point.id) ? listings[point.id] : null);
    return fact ? [{ id: point.id, name: point.name, borough: point.borough, walkMinutes, ...fact }] : [];
  });
  if (pool.length < 3) return null;
  const remaining = [...pool];
  const cards: PubTarotCard[] = [];
  while (cards.length < 3) {
    const draw = options.random();
    const unit = Number.isFinite(draw) ? Math.min(Math.max(draw, 0), 1 - Number.EPSILON) : 0;
    cards.push(remaining.splice(Math.floor(unit * remaining.length), 1)[0]!);
  }
  return { cards, poolSize: pool.length };
}
