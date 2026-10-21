import type { PalCard } from "@/lib/palChat";
import type { SlimVenue } from "@/lib/venuesSlim";

type ScreenPoint = { x: number; y: number };

/** Separate nearby numbered buttons while their stems retain the real locations. */
export function palRecommendationPinOffsets(points: readonly ScreenPoint[]): ScreenPoint[] {
  const groups = points.map((_, index) => [index]);
  let placed = points.map((point) => ({ ...point }));
  for (;;) {
    placed = points.map((point) => ({ ...point }));
    for (const group of groups) {
      if (group.length < 2) continue;
      const centre = group.reduce((sum, index) => ({ x: sum.x + points[index]!.x / group.length, y: sum.y + points[index]!.y / group.length }), { x: 0, y: 0 });
      const radius = Math.max(56, 32 / Math.sin(Math.PI / group.length));
      group.forEach((index, position) => {
        const angle = -Math.PI / 2 + position * Math.PI * 2 / group.length;
        placed[index] = { x: centre.x + Math.cos(angle) * radius, y: centre.y + Math.sin(angle) * radius };
      });
    }
    let merged = false;
    merge: for (let first = 0; first < groups.length; first += 1) {
      for (let next = first + 1; next < groups.length; next += 1) {
        const collision = groups[first]!.some((a) => groups[next]!.some((b) =>
          Math.max(Math.abs(placed[a]!.x - placed[b]!.x), Math.abs(placed[a]!.y - placed[b]!.y)) < 48,
        ));
        if (!collision) continue;
        groups[first]!.push(...groups[next]!);
        groups.splice(next, 1);
        merged = true;
        break merge;
      }
    }
    if (!merged) return placed.map((point, index) => ({ x: point.x - points[index]!.x, y: point.y - points[index]!.y }));
  }
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
