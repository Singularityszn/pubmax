// What KIND of night one /out listing is, said in a word a drinker uses.
//
// The What's-On vocabulary (lib/whatsOn.ts) is five words wide - sport, quiz,
// deal, music, event - because it was built for a pub spine. /out lists the
// whole city, so "event" ends up carrying an arena musical, a warehouse rave, a
// stand-up night and a street-food market at once, and a reader scanning the
// list cannot tell them apart.
//
// This is a DERIVED read, never a second taxonomy. It changes no row and no
// stored field: it reads the words the source already published (the provider's
// own genre in `detail`, then the title) and answers with one of seven labels.
// A row it cannot place honestly is "other", which prints as "Event" - the same
// claim the row already made - rather than a guess.

import type { WhatsOnRow } from "@/lib/whatsOn";

export const OUT_LISTING_KINDS = [
  "gig",
  "club-night",
  "comedy",
  "theatre",
  "food",
  "market",
  "other",
] as const;

export type OutListingKind = (typeof OUT_LISTING_KINDS)[number];

/** The one spelling of each kind. The chip, the filter and the test share it. */
export const OUT_LISTING_KIND_LABEL: Record<OutListingKind, string> = {
  gig: "Gig",
  "club-night": "Club night",
  comedy: "Comedy",
  theatre: "Theatre",
  food: "Food",
  market: "Market",
  other: "Event",
};

// Order matters: the first rule that matches wins, so the narrower reading is
// listed above the wider one it would otherwise be swallowed by. "Comedy
// Theatre" is comedy; "club classics" is a club night before it is a gig.
const RULES: readonly { kind: OutListingKind; pattern: RegExp }[] = [
  {
    kind: "comedy",
    pattern: /\b(comedy|stand[- ]?up|improv|sketch show|open mic night)\b/i,
  },
  {
    kind: "club-night",
    pattern:
      /\b(club night|clubnight|nightclub|rave|dj set|djs?|house|techno|garage|drum ?(?:&|and) ?bass|d ?& ?b|dubstep|trance|disco|afterparty|after[- ]hours|electronic dance)\b/i,
  },
  {
    kind: "theatre",
    pattern:
      /\b(theatre|theater|musical|west end|play|panto(?:mime)?|opera|ballet|dance company|circus|cabaret|burlesque|drag show)\b/i,
  },
  {
    kind: "market",
    pattern: /\b(market|makers? fair|flea|car boot|craft fair|street fair|bazaar)\b/i,
  },
  {
    kind: "food",
    pattern:
      /\b(supper club|supperclub|tasting|dining|dinner|brunch|lunch|street food|food hall|feast|bottomless|wine tasting|beer tasting|restaurant|chef|pop[- ]?up kitchen)\b/i,
  },
  {
    kind: "gig",
    pattern:
      /\b(gig|live music|band|concert|acoustic|rock|indie|pop|jazz|folk|metal|punk|blues|soul|funk|hip[- ]?hop|rap|r ?& ?b|grime|orchestra|choir|singer|tour)\b/i,
  },
];

/**
 * The kind one listing is, read off what the source published.
 *
 * The provider's own genre (`detail`) is asked first because it is the
 * publisher's claim about its own event; the title is the fall-back, and a
 * title is a marketing line, so it decides only when there is no genre to read.
 * The What's-On kind is the floor: a `music` row with no readable words is a
 * gig, because that is exactly what its own lane already called it.
 */
export function outListingKind(
  row: Pick<WhatsOnRow, "kind" | "title"> & Partial<Pick<WhatsOnRow, "detail">>,
): OutListingKind {
  const detail = row.detail?.trim() ?? "";
  for (const source of [detail, row.title]) {
    if (!source) continue;
    for (const rule of RULES) {
      if (rule.pattern.test(source)) return rule.kind;
    }
  }
  if (row.kind === "music") return "gig";
  return "other";
}

/** The chip one listing prints. */
export function outListingKindLabel(
  row: Pick<WhatsOnRow, "kind" | "title"> & Partial<Pick<WhatsOnRow, "detail">>,
): string {
  return OUT_LISTING_KIND_LABEL[outListingKind(row)];
}
