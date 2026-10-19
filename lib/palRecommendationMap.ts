import type { PalCard } from "@/lib/palChat";
import type { SlimVenue } from "@/lib/venuesSlim";

type ScreenPoint = { x: number; y: number };

/** Separate nearby numbered buttons while their stems retain the real locations. */
export function palRecommendationPinOffsets(points: readonly ScreenPoint[]): ScreenPoint[] {
  const offsets = points.map(() => ({ x: 0, y: 0 }));
  const seen = new Set<number>();
  for (let first = 0; first < points.length; first += 1) {
    if (seen.has(first)) continue;
    const group = [first];
    seen.add(first);
    for (let cursor = 0; cursor < group.length; cursor += 1) {
      const point = points[group[cursor]!]!;
      for (let next = 0; next < points.length; next += 1) {
        if (seen.has(next) || Math.hypot(point.x - points[next]!.x, point.y - points[next]!.y) >= 56) continue;
        seen.add(next);
        group.push(next);
      }
    }
    if (group.length < 2) continue;
    const centre = group.reduce((sum, index) => ({ x: sum.x + points[index]!.x / group.length, y: sum.y + points[index]!.y / group.length }), { x: 0, y: 0 });
    const radius = Math.max(56, 32 / Math.sin(Math.PI / group.length));
    group.forEach((index, position) => {
      const angle = -Math.PI / 2 + position * Math.PI * 2 / group.length;
      offsets[index] = { x: centre.x + Math.cos(angle) * radius - points[index]!.x, y: centre.y + Math.sin(angle) * radius - points[index]!.y };
    });
  }
  return offsets;
}

export type PalRecommendationPoint = {
  venueId: string;
  name: string;
  lat: number;
  lng: number;
  number: number;
};

/** Locate only this answer's pubs, by identity in the published index. */
export function palRecommendationPoints(
  cards: readonly PalCard[],
  venues: readonly Pick<SlimVenue, "id" | "lat" | "lng">[],
): PalRecommendationPoint[] {
  const index = new Map(venues.map((venue) => [venue.id, venue]));
  const seen = new Set<string>();
  return cards.flatMap((card, position) => {
    const venue = index.get(card.venueId);
    if (!venue || seen.has(card.venueId)
      || !Number.isFinite(venue.lat) || !Number.isFinite(venue.lng)
      || Math.abs(venue.lat) > 90 || Math.abs(venue.lng) > 180) return [];
    seen.add(card.venueId);
    return [{ venueId: card.venueId, name: card.title, lat: venue.lat, lng: venue.lng, number: position + 1 }];
  });
}
