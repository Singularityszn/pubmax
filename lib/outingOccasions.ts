import {
  rankConciergeVenues,
  type ConciergeMood,
  type ConciergeVenue,
} from "@/lib/concierge/rank";
import type { WhatsOnRow } from "@/lib/whatsOn";
import { outListingKind } from "@/lib/out/listingKind";
import {
  outingEventStopFromRow,
} from "@/lib/outingEventStop";
import type { OutingIntent } from "@/lib/outingIntent";

export { cleanOutingEventStop, type OutingEventStop } from "@/lib/outingEventStop";
export { outingIntentParams, parseOutingIntent, type OutingAlcoholPreference, type OutingIntent } from "@/lib/outingIntent";

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

export const outingEventStop = outingEventStopFromRow;

export function parseOutingOccasion(value: unknown): OutingOccasion {
  return typeof value === "string" && Object.hasOwn(OUTING_OCCASIONS, value)
    ? (value as OutingOccasion)
    : "date";
}

const ASKS: Record<OutingOccasion, string> = {
  date: "Find a date-night pub",
  friends: "Plan a lively night with friends",
  dancing: "Find a club night",
  music: "Find live music",
  quiet: "Find a quiet pub for a chat",
  gardens: "Find a pub with a garden",
  crawl: "Plan a pub crawl",
};

export function outingAsk(occasion: OutingOccasion, area: string, intent?: OutingIntent): string {
  const location = area.trim() ? ` in ${area.trim()}` : " in London";
  if (!intent) return `${ASKS[occasion]}${location}`;
  const constraints = [
    intent.date ? `on ${intent.date}` : "",
    intent.time ? `around ${intent.time}` : "",
    intent.groupSize ? `for ${intent.groupSize} ${intent.groupSize === 1 ? "person" : "people"}` : "",
    intent.budgetGbp !== null ? `up to £${intent.budgetGbp.toFixed(2)} per person` : "",
    intent.alcohol === "none" ? "with no alcohol" : intent.alcohol === "included" ? "alcohol is okay" : "",
  ].filter(Boolean);
  return `${ASKS[occasion]}${location}${constraints.length ? `, ${constraints.join(", ")}` : ""}`;
}

/** Positive recorded amenities explain estimates; missing flags prove nothing. */
export function outingBasis(venue: ConciergeVenue): string[] {
  return [
    venue.amenities.food ? "Food listed" : null,
    venue.amenities.cocktails ? "Cocktails listed" : null,
    venue.amenities.beerGarden ? "Garden listed" : null,
    venue.amenities.nonAlcoholic === true ? "Alcohol-free drinks listed" : null,
    venue.hasStory ? "Heritage on record" : null,
    venue.nearWater ? "Near the water" : null,
  ].filter((value): value is string => value !== null);
}

export function outingShortlist(
  venues: readonly ConciergeVenue[],
  occasion: OutingOccasion,
  area: string,
  options: {
    date?: string;
    events?: readonly WhatsOnRow[];
    groupSize?: number;
    alcohol?: OutingIntent["alcohol"];
  } = {},
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
    if (options.alcohol === "none" && venue.amenities.nonAlcoholic !== true) return false;
    if (occasion === "gardens") return venue.amenities.beerGarden === true;
    if (occasion === "quiet")
      return (
        (venue.amenities.food || venue.hasStory) &&
        venue.amenities.liveMusic === false &&
        venue.amenities.liveSports === false &&
        !options.events?.some((row) => {
          if (row.venueId !== venue.id || !options.date) return false;
          const loud = row.kind === "music" || row.kind === "sport" || (
            row.kind === "event" && ["club-night", "gig"].includes(outListingKind(row))
          );
          if (!loud) return false;
          const eventDate = row.startsDate ?? (row.startsAt
            ? new Intl.DateTimeFormat("en-GB", {
                timeZone: "Europe/London",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
              }).formatToParts(new Date(row.startsAt)).reduce((parts, part) => {
                if (part.type !== "literal") parts[part.type] = part.value;
                return parts;
              }, {} as Record<string, string>)
            : null);
          const londonDate = typeof eventDate === "object" && eventDate !== null
            ? `${eventDate.year}-${eventDate.month}-${eventDate.day}`
            : eventDate;
          return londonDate === options.date;
        })
      );
    if (occasion === "date") return outingBasis(venue).length > 0;
    return true;
  });
  return rankConciergeVenues(
    eligible,
    { mood: moods[occasion], groupSize: options.groupSize ?? 2, area },
    { limit: 6 },
  );
}
