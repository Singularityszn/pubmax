import {
  rankConciergeVenues,
  type ConciergeMood,
  type ConciergeVenue,
} from "@/lib/concierge/rank";

export const OUTING_OCCASIONS = {
  date: "Date night",
  friends: "With friends",
  dancing: "Dancing",
  music: "Live music",
  quiet: "Quiet conversation",
  gardens: "Gardens",
  crawl: "Pub crawl",
} as const;
export type OutingOccasion = keyof typeof OUTING_OCCASIONS;

export function parseOutingOccasion(value: unknown): OutingOccasion {
  return typeof value === "string" && Object.hasOwn(OUTING_OCCASIONS, value)
    ? (value as OutingOccasion)
    : "date";
}

const ASKS: Record<OutingOccasion, string> = {
  date: "Find a date-night pub",
  friends: "Plan a lively night for four of us",
  dancing: "Find a club night",
  music: "Find live music",
  quiet: "Find a quiet pub for a chat",
  gardens: "Find a pub with a garden",
  crawl: "Plan a pub crawl",
};

export function outingAsk(occasion: OutingOccasion, area: string): string {
  return `${ASKS[occasion]}${area.trim() ? ` in ${area.trim()}` : " in London"}`;
}

/** Positive recorded amenities explain estimates; missing flags prove nothing. */
export function outingBasis(venue: ConciergeVenue): string[] {
  return [
    venue.amenities.food ? "Food listed" : null,
    venue.amenities.cocktails ? "Cocktails listed" : null,
    venue.amenities.beerGarden ? "Garden listed" : null,
    venue.hasStory ? "Heritage on record" : null,
    venue.nearWater ? "Near the water" : null,
  ].filter((value): value is string => value !== null);
}

export function outingShortlist(
  venues: readonly ConciergeVenue[],
  occasion: OutingOccasion,
  area: string,
) {
  const moods: Record<OutingOccasion, ConciergeMood[]> = {
    date: ["date"],
    friends: ["balanced"],
    dancing: ["lively"],
    music: ["lively"],
    quiet: ["quiet"],
    gardens: ["garden"],
    crawl: ["balanced"],
  };
  const eligible = venues.filter((venue) => {
    if (occasion === "gardens") return venue.amenities.beerGarden === true;
    if (occasion === "quiet")
      return (
        (venue.amenities.food || venue.hasStory) &&
        !venue.amenities.liveMusic &&
        !venue.amenities.liveSports
      );
    if (occasion === "date") return outingBasis(venue).length > 0;
    return true;
  });
  return rankConciergeVenues(
    eligible,
    { mood: moods[occasion], groupSize: occasion === "friends" ? 4 : 2, area },
    { limit: 6 },
  );
}
