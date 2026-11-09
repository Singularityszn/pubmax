import type { PubComparisonResultVenue } from "@/lib/pubComparison";
import { cleanPollOptions, POLL_OPTION_MAX, type MessagePollWrite } from "@/lib/messagePoll";
import { PRODUCTION_SITE_ORIGIN } from "@/lib/siteUrlConfig.mjs";

export function comparisonMoney(pence: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);
}

/** Both rows belong to the same comparison response and therefore the same order. */
export function comparisonDetour(base: PubComparisonResultVenue, other: PubComparisonResultVenue): {
  savingPence: number; extraMinutes: number;
} | null {
  if (base.totalPence === null || other.totalPence === null
    || base.walk.status !== "routed" || other.walk.status !== "routed"
    || base.walk.method !== other.walk.method || base.walk.timing !== other.walk.timing
    || base.walk.minutes === null || other.walk.minutes === null) return null;
  return { savingPence: base.totalPence - other.totalPence, extraMinutes: other.walk.minutes - base.walk.minutes };
}

export function comparisonPubLabel(venue: Pick<PubComparisonResultVenue, "name" | "address" | "borough">): string {
  return [venue.name, venue.address || venue.borough].filter(Boolean).join(", ");
}

/** Public sharing excludes the person's order, meeting point and totals. */
export function comparisonShareText(venues: readonly PubComparisonResultVenue[]): string {
  return ["Which pub works for us?", ...venues.map((venue, index) =>
    `${index + 1}. ${comparisonPubLabel(venue)}${venue.totalPence === null ? " (Order incomplete)" : ""}\n${PRODUCTION_SITE_ORIGIN}/ledger/${encodeURIComponent(venue.id)}`),
  "Compare your own order. Listed prices can change.", `${PRODUCTION_SITE_ORIGIN}/tools`].join("\n\n");
}

export function comparisonPoll(venues: readonly PubComparisonResultVenue[]): MessagePollWrite | null {
  const options = cleanPollOptions(venues.map((venue, index) =>
    `${index + 1}. ${comparisonPubLabel(venue)}`.slice(0, POLL_OPTION_MAX)));
  return options ? { question: "Which pub works for us?", options } : null;
}
