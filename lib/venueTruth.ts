// WHAT WE ACTUALLY KNOW ABOUT ONE VENUE, said in states rather than booleans.
//
// A venue record carries three different kinds of thing and the product used to
// publish all three as plain values: a fact the source STATED, a fact nobody
// recorded, and a reading we DERIVED from a clock. A boolean cannot hold that
// difference, so every blank column left the building as `false`, an unread
// phone column left as a `tel:` candidate, and a group-fit guess left wearing
// the word "likely" over a pub whose opening hours are unknown.
//
// This module is the ONE owner of the derived view. It is a PURE LEAF: it
// imports only other leaves (`lib/haversine`, `lib/httpUrl`), so a bundle that
// needs the word "unknown" pulls no venue index behind it. Every reader that
// PRINTS one of these facts asks here; no surface re-derives one.
//
// Measured on production 6 September 2026, `GET /api/venue/venue-p7p18j`:
//   phone_number  "\u{1F310} https://www.lsesu.com/social/three-tuns/"
//   amenities     every key false, while the source row states "" for each
//   getIn.fit     "likely", while busyness.isOpen is "unknown", reportCount 0
// Each of those is one of the distinctions below, published the wrong way round.

import { haversineKm } from "@/lib/haversine";
import { firstHttp, firstHttps, isHttpUrl } from "@/lib/httpUrl";

/* ------------------------------------------------------------------ *
 * The distinctions, named once                                        *
 * ------------------------------------------------------------------ */

/**
 * The seven pairs this module refuses to merge. Each row is one question, the
 * two answers a reader must be able to tell apart, and the sentence saying why
 * merging them lies. `__tests__/venueTruth.test.ts` holds the table to the
 * states the module really publishes, so a new state cannot arrive unnamed and
 * a named one cannot quietly disappear.
 */
export const VENUE_TRUTH_DISTINCTIONS = [
  {
    id: "recorded-vs-readable",
    question: "Why is there no answer?",
    states: ["unknown", "unavailable"],
    why: "Nobody recorded this, and we could not run the read, are two findings with two owners.",
  },
  {
    id: "opening-vs-closed",
    question: "Is the door open?",
    states: ["unknown", "closed"],
    why: "Unknown opening hours are not a closed pub, and may never filter one out as shut.",
  },
  {
    id: "pattern-vs-observation",
    question: "How busy is it?",
    states: ["typical-pattern", "community-report"],
    why: "A clock heuristic for this hour is not somebody standing at the door.",
  },
  {
    id: "nearby-vs-inside",
    question: "Which area is this pub in?",
    states: ["inside", "nearby"],
    why: "An area's radius is the furthest a pub can be and still be listed there. It is not a claim that the pub is in that place.",
  },
  {
    id: "one-price-vs-corroborated",
    question: "How good is this price?",
    states: ["logged-once", "corroborated"],
    why: "One drinker's report is a price. Two independent ones are an agreement. lib/pintTrust.ts owns that reading and this module never restates it.",
  },
  {
    id: "stated-absent-vs-blank",
    question: "Does the pub have this?",
    states: ["known-false", "unknown"],
    why: "A source that states an amenity is absent is evidence. A blank column is not, and publishing it as false invents a negative.",
  },
  {
    id: "evidenced-vs-guessed",
    question: "Will the group get in?",
    states: ["evidenced", "pattern-only"],
    why: "A positive answer needs the door to be known open and somebody to have looked. Anything else is a guess wearing a confident word.",
  },
] as const;

type VenueTruthDistinctionId = (typeof VENUE_TRUTH_DISTINCTIONS)[number]["id"];

/* ------------------------------------------------------------------ *
 * Contacts                                                            *
 * ------------------------------------------------------------------ */

/**
 * The only contact fields a reader or an API caller may see. Every field is
 * null unless the raw source value PARSES as the thing its column claims to
 * be, so a website URL sitting in a phone column reaches nobody as a phone
 * number and can never become a `tel:` link.
 */
export type VenueContactContract = {
  /** The telephone number as a reader should see it, or null. */
  phoneNumber: string | null;
  /** `tel:` href built from that number, or null. Never built from anything else. */
  phoneHref: string | null;
  /** The venue's own site, https preferred, or null. */
  websiteHref: string | null;
  /** `mailto:` href, or null. */
  emailHref: string | null;
  /** A table-booking page, or null. Never a search link: lib/venueExternalActions owns that fallback. */
  bookingHref: string | null;
};

export type VenueContactSource = {
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  bookingLink?: string | null;
};

/** E.164 allows 15 digits; a UK local number is 7 at the short end. */
const PHONE_MIN_DIGITS = 7;
const PHONE_MAX_DIGITS = 15;

/**
 * A telephone number, or null.
 *
 * The bar is deliberately narrow: after an optional `tel:` prefix the value may
 * hold DIGITS and the punctuation people write numbers with, and nothing else.
 * A letter, an `@`, a `/` or an emoji refuses the whole value rather than being
 * stripped out of it, because a value we had to edit to make dialable is a
 * value we did not understand.
 */
export function parsePhoneNumber(raw: string | null | undefined): string | null {
  const value = String(raw ?? "").trim().replace(/^tel:/i, "").trim();
  if (!value) return null;
  if (!/^[+()\-.\s\d]+$/.test(value)) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < PHONE_MIN_DIGITS || digits.length > PHONE_MAX_DIGITS) return null;
  // Collapse the writing style, keep a leading + because it carries the country.
  const plus = value.trimStart().startsWith("+") ? "+" : "";
  return `${plus}${digits}`;
}

/** An email address, or null. One `@`, no spaces, a dotted domain. */
export function parseEmailAddress(raw: string | null | undefined): string | null {
  const value = String(raw ?? "").trim().replace(/^mailto:/i, "").trim();
  if (!value || /\s/.test(value)) return null;
  if (!/^[^@]+@[^@]+\.[^@.]{2,}$/.test(value)) return null;
  return value;
}

/**
 * The sanitized contact contract for one venue. Takes raw column values, so the
 * caller may hand it a grouped venue or a single source row without either
 * side learning the other's shape.
 */
export function venueContactContract(source: VenueContactSource): VenueContactContract {
  const phoneNumber = parsePhoneNumber(source.phone);
  const email = parseEmailAddress(source.email);
  const website = firstHttps(source.website ?? "") || firstHttp(source.website ?? "");
  const booking = firstHttps(source.bookingLink ?? "") || firstHttp(source.bookingLink ?? "");
  return {
    phoneNumber,
    phoneHref: phoneNumber ? `tel:${phoneNumber}` : null,
    websiteHref: website || null,
    emailHref: email ? `mailto:${email}` : null,
    bookingHref: booking || null,
  };
}

/** Whether a raw value is safe to publish as a contact of its own column's kind. */
export function contactValueIsPublishable(kind: "phone" | "email" | "url", raw: string): boolean {
  if (kind === "phone") return parsePhoneNumber(raw) !== null;
  if (kind === "email") return parseEmailAddress(raw) !== null;
  return isHttpUrl(raw.trim());
}

/* ------------------------------------------------------------------ *
 * Amenities                                                           *
 * ------------------------------------------------------------------ */

/**
 * What the source says about one amenity.
 *
 * `known-false` exists because a source MAY state an absence and that is real
 * evidence. No source this tree holds states one today: the bundled dataset's
 * ten amenity columns carry only yes-shaped values and blanks (measured 6
 * September 2026 over 3,760 rows). So every `false` the product used to publish
 * was invented, and the state a blank earns is `unknown`.
 */
export type AmenityStatus = "known-true" | "known-false" | "unknown";

const YES_SHAPED = /^(yes|y|true|1)\b/;
const NO_SHAPED = /^(no|n|false|0|none)\b(?!\/)/;
/** Values that say the question was not answered. They are never an absence. */
const NOT_APPLICABLE_SHAPED = /^(n\/a|na|n\.a\.?|not applicable|unknown|tbc|tbd|-|\?)$/;

/**
 * Read ONE raw amenity value.
 *
 * A leading yes carries a qualifier with it, so "yes (fri & sat)" and "yes
 * sundays" are the statements they look like rather than the falses an exact
 * match made of them. A value that answers a DIFFERENT question ("Dog friendly"
 * in the cocktails column, one row in the bundled dataset) is `unknown`: it is
 * not a cocktails claim in either direction, and under-inclusive is the safe
 * side. A value saying the question was NOT ANSWERED ("N/A", "unknown", "-") is
 * unknown too, and is read before the no-shaped rule, which used to match the
 * `n` of "n/a" and turn it into its own opposite.
 */
export function amenityStatusFromValue(raw: string | null | undefined): AmenityStatus {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return "unknown";
  // "N/A" MEANS THE OPPOSITE OF NO. The no-shaped alternative `n` matched it,
  // because `/` is a word boundary, so a value saying nobody answered read as a
  // STATED absence - the invented negative this whole module exists to refuse.
  // No such value is in the shipped dataset today (measured 6 September 2026);
  // this is the harvest overlay and the next re-collection being asked the same
  // question the columns already are.
  if (NOT_APPLICABLE_SHAPED.test(value)) return "unknown";
  if (YES_SHAPED.test(value)) return "known-true";
  if (NO_SHAPED.test(value)) return "known-false";
  return "unknown";
}

/**
 * Read every value a grouped venue holds for one amenity. A stated presence
 * anywhere in the group wins, because one row saying yes is a pub that has it;
 * only when nothing states a presence does a stated absence answer.
 */
export function amenityStatusFromValues(values: readonly (string | null | undefined)[]): AmenityStatus {
  const states = values.map(amenityStatusFromValue);
  if (states.includes("known-true")) return "known-true";
  if (states.includes("known-false")) return "known-false";
  return "unknown";
}

/**
 * A fact DERIVED from what the pub's listed drinks are called, never a column.
 * A hit is a statement; a miss is not, because a pint list is not a menu. So
 * this lane answers `known-true` or `unknown` and never `known-false`.
 */
export function derivedAmenityStatus(found: boolean): AmenityStatus {
  return found ? "known-true" : "unknown";
}

/* ------------------------------------------------------------------ *
 * Suitability and getting in                                          *
 * ------------------------------------------------------------------ */

/**
 * How much a get-in answer is worth.
 *  - `evidenced`    the door is known open AND somebody has looked recently.
 *  - `pattern-only` a clock heuristic for this hour, about pubs in general.
 *  - `unknown`      we cannot say the door is open, so we say nothing about it.
 */
export type GetInConfidence = "evidenced" | "pattern-only" | "unknown";

/** The line a surface prints under a get-in answer, one per confidence. */
export const GET_IN_CONFIDENCE_LINE: Record<GetInConfidence, string> = {
  evidenced: "Somebody reported the room in the last hour or so.",
  "pattern-only": "That is the usual pattern for this hour. We are not watching the door.",
  unknown: "We do not hold opening hours for this pub, so we cannot say.",
};

export type GetInEvidence = {
  /** Whether listed hours cover now: `true`, `false`, or `"unknown"`. */
  openState: boolean | "unknown";
  /** How many fresh community reports stand behind the busyness reading. */
  reportCount: number;
  /** Where the busyness reading came from. */
  busynessSource: "typical-pattern" | "community-report";
};

/**
 * The confidence a get-in answer may claim.
 *
 * A positive answer needs the door to be known open and somebody to have looked.
 * The clock heuristic is about the hour rather than this pub, so it corroborates
 * nothing on its own and can never lift an answer to `evidenced`.
 */
export function getInConfidence(evidence: GetInEvidence): GetInConfidence {
  if (evidence.openState === "unknown") return "unknown";
  if (evidence.busynessSource === "community-report" && evidence.reportCount > 0) {
    return "evidenced";
  }
  return "pattern-only";
}

/**
 * Whether a get-in answer is allowed to be worded positively. This is the gate
 * the "likely" wording sits behind: it is the whole of finding F03(c).
 */
export function getInMayClaimLikely(evidence: GetInEvidence): boolean {
  return getInConfidence(evidence) === "evidenced";
}

/* ------------------------------------------------------------------ *
 * Locality                                                            *
 * ------------------------------------------------------------------ */

/**
 * The minimal shape this module needs from a Night Area. `NightArea` satisfies
 * it structurally, so the leaf never imports the catalogue.
 */
export type AreaDisc = {
  slug: string;
  name: string;
  centre: { lat: number; lng: number };
  radiusKm: number;
};

/**
 * How much of an area's curated radius may be called its core.
 *
 * An area's `radiusKm` is the furthest a pub can be and still be LISTED there.
 * A claim that a pub is IN that place is stronger and is made only from the
 * inner part of the disc. Measured over the 1,995 shipped slim rows on 6
 * September 2026: 791 sit inside some London area's disc, and a pub in the
 * inner three quarters names its own area in its own address 37.8% of the time
 * against 23.4% for a pub in the outer band. The band is doing real work, and
 * it costs 167 rows (21%) a downgrade from "in" to "near", which is the honest
 * word for them.
 *
 * The Three Tuns at the LSE student centre sits 1.217 km from the Piccadilly &
 * Soho centre, 0.87 of that area's 1.4 km radius. It was filed as being in Soho.
 */
export const AREA_CORE_RADIUS_FRACTION = 0.75;

export type VenueAreaRelation = "inside" | "nearby" | "unplaced";

export type VenueAreaClaim =
  | { relation: "inside"; area: AreaDisc; distanceKm: number }
  | { relation: "nearby"; area: AreaDisc; distanceKm: number }
  | { relation: "unplaced"; area: null; distanceKm: null };

const UNPLACED: VenueAreaClaim = { relation: "unplaced", area: null, distanceKm: null };

/**
 * Which area may claim this point, and how strongly. The nearest containing
 * disc wins as it always did, with the slug as the tie-break, so nothing about
 * which area LISTS a pub moves. What is new is the strength of the claim.
 */
export function venueAreaClaim(
  point: { longitude: number; latitude: number },
  areas: readonly AreaDisc[],
): VenueAreaClaim {
  if (!Number.isFinite(point.longitude) || !Number.isFinite(point.latitude)) return UNPLACED;
  const nearest = areas
    .map((area) => ({
      area,
      distanceKm: haversineKm(
        [point.longitude, point.latitude],
        [area.centre.lng, area.centre.lat],
      ),
    }))
    .filter(({ area, distanceKm }) => distanceKm <= area.radiusKm)
    .sort(
      (left, right) =>
        left.distanceKm - right.distanceKm || left.area.slug.localeCompare(right.area.slug),
    )[0];
  if (!nearest) return UNPLACED;
  const relation =
    nearest.distanceKm <= nearest.area.radiusKm * AREA_CORE_RADIUS_FRACTION ? "inside" : "nearby";
  return { relation, area: nearest.area, distanceKm: nearest.distanceKm };
}

/**
 * The words for one claim. `null` when nothing may be said, so a caller cannot
 * print an empty locality by accident.
 */
export function areaClaimLabel(claim: VenueAreaClaim): string | null {
  if (claim.relation === "unplaced") return null;
  return claim.relation === "inside" ? claim.area.name : `Near ${claim.area.name}`;
}

/**
 * The short qualifier a list row wears when it is only NEAR the area it is
 * listed under. It says the relation to the PLACE, not to the reader: a list
 * headed "The cheap ones in Piccadilly & Soho" is about that place, and
 * "Nearby" on a row there reads as near the person holding the phone.
 */
export const AREA_NEARBY_ROW_TAG = "Just outside";
