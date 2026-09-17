// WHAT WE TELL SOMEBODY BEFORE THEY SHARE THEIR LOCATION, AND NOWHERE ELSE.
//
// Astra F01 (6 Sep 2026): /today's get-there card asked for a location under
// the sentence "It stays on this page and is never saved.", and then sent a
// rounded point to /api/last-train and /api/tfl-disruption, and our server
// passed it on to Transport for London. /privacy said so in full. The prompt
// and the policy were describing two different products, and the prompt was
// the one the reader was answering.
//
// This module is the ONE place those words live. It is a PURE LEAF: it imports
// nothing, so a surface that only needs the sentence never pulls a transport
// or geo module in behind it.
//
// THE RULE. A disclosure is ACTION-SPECIFIC. It answers, in this order, and
// says nothing it cannot keep:
//
//   1. what the browser works out here and never sends (may be nothing),
//   2. what leaves, how coarse it is, and which of OUR routes takes it,
//   3. who our server passes the rounded point on to (may be nobody),
//   4. what we keep.
//
// THE OTHER HALF IS THE WAY OUT. A refused location is not an error, so a
// surface that asks must also offer an answer that needs no location at all:
// here that is picking an area, and its result is worded as the AREA's nearest
// station, never as the reader's.

/**
 * The closed set of surfaces that ask a reader for their location for
 * transport. A surface outside this set has no disclosure and may not ask.
 */
export type LocationAskSurface =
  | "today-last-train"
  | "tonight-walk-and-last-train";

/**
 * How coarse the point is by the time it leaves the browser.
 *
 * `coarsenViewerPoint` rounds to three decimals, roughly 70 to 110 metres in
 * London. /privacy states that range; a prompt says the round number a person
 * can picture. Both describe the same rounding, and neither may drift from it.
 */
export const LOCATION_ROUNDING_LABEL = "about 100 metres";

export type LocationDisclosure = {
  /** Worked out here and never sent. Null where nothing is. */
  onPage: string | null;
  /** What leaves, how coarse, and which of our own routes takes it. */
  sent: string;
  /** Who our server passes the rounded point to. Null where nobody does. */
  thirdParty: string | null;
  /** What we keep afterwards. */
  storage: string;
};

const SENT_LINE = `We round your location to ${LOCATION_ROUNDING_LABEL} and send it to our server.`;
const TFL_LINE =
  "The server asks Transport for London for your nearest station and last train.";
const STORAGE_LINE = "We do not store your location.";

/**
 * The disclosure each asking surface spends. Written out per surface rather
 * than composed from flags, so the difference between two asks is readable
 * here instead of being reconstructed from a branch.
 */
export const LOCATION_DISCLOSURES: Readonly<
  Record<LocationAskSurface, LocationDisclosure>
> = Object.freeze({
  "today-last-train": {
    onPage: null,
    sent: SENT_LINE,
    thirdParty: TFL_LINE,
    storage: STORAGE_LINE,
  },
  "tonight-walk-and-last-train": {
    onPage: "Walk times are worked out on this page.",
    sent: SENT_LINE,
    thirdParty: TFL_LINE,
    storage: STORAGE_LINE,
  },
});

/** The disclosure as the lines a surface prints, in order. */
export function locationDisclosureLines(
  surface: LocationAskSurface,
): readonly string[] {
  const disclosure = LOCATION_DISCLOSURES[surface];
  return [
    disclosure.onPage,
    disclosure.sent,
    disclosure.thirdParty,
    disclosure.storage,
  ].filter((line): line is string => Boolean(line));
}

/**
 * Claims a surface that SENDS the point may never make about it.
 *
 * One rule, one class, one reason, in the lib/heritageLanguageGate.mjs idiom:
 * a refusal has to say which promise was broken, not only that something
 * matched. Each pattern is deliberately narrow, because a rule that also
 * refuses honest copy gets switched off, and a rule that is off catches
 * nothing.
 */
const LOCATION_OVERCLAIM_RULES = Object.freeze([
  {
    id: "never-leaves",
    why: "says the point does not leave the device, and it does",
    pattern:
      /\bnever leaves?\b|\bdoes not leave\b|\bstays? on (?:this|your) (?:page|device)\b/i,
  },
  {
    id: "never-saved",
    why: "answers storage without saying what was sent first",
    pattern: /\bis never (?:saved|stored)\b/i,
  },
  {
    id: "on-device-only",
    why: "claims the whole answer is worked out here, and it is not",
    pattern: /\bon(?:-| )device only\b|\bonly on your device\b/i,
  },
]);

/** Every overclaim in one piece of prompt copy, in table order. */
export function locationOverclaimFindings(
  text: string,
): { id: string; why: string }[] {
  const haystack = String(text ?? "");
  if (!haystack.trim()) return [];
  return LOCATION_OVERCLAIM_RULES.filter((rule) =>
    rule.pattern.test(haystack),
  ).map((rule) => ({ id: rule.id, why: rule.why }));
}

// ── The controls ─────────────────────────────────────────────────────────

/** Named on the button that makes the ask. The ask is always a tap. */
export const LOCATION_SHARE_LABEL: Readonly<Record<LocationAskSurface, string>> =
  Object.freeze({
    "today-last-train": "Share location for your last train",
    "tonight-walk-and-last-train": "Share location for walk times and last train",
  });

export const LOCATION_FINDING_LABEL = "Finding your location…";
export const LOCATION_RETRY_LABEL = "Try location again";
export const LOCATION_REMOVE_LABEL = "Remove location";

/** The screen-reader line while the browser is answering. */
export const LOCATION_FINDING_STATUS = "Finding your location.";
/** The screen-reader line once the browser has refused or failed. */
export const LOCATION_UNAVAILABLE_STATUS =
  "Location unavailable. You can try again.";

// ── The way out ──────────────────────────────────────────────────────────

/**
 * The offer made when the browser says no, or was never asked.
 *
 * It is not an apology and not a retry: it is a different question, answerable
 * with no location at all.
 */
export const LOCATION_MANUAL_PROMPT =
  "No location? Pick an area and we will use its nearest station.";

/** Named on the control that opens the area choice. */
export const LOCATION_MANUAL_OPEN_LABEL = "Pick an area instead";

/** Named on the control that reopens the area choice. */
export const LOCATION_MANUAL_CHANGE_LABEL = "Change area";

/**
 * What the answer says when the origin is an AREA rather than the reader.
 *
 * The station is the area's nearest, so the line names the area. Calling it
 * "your nearest station" would be the same class of untruth this module was
 * written for.
 */
export function locationAreaOriginLine(areaLabel: string): string {
  return `Nearest station to ${areaLabel}.`;
}

/** The accessible name for the area chooser. */
export const LOCATION_MANUAL_GROUP_LABEL = "Pick an area for your last train";

/**
 * Where a reader goes to read the whole thing.
 *
 * The prompt states the practice; /privacy states it in full, names the routes
 * by path and names Transport for London as the processor. They are the same
 * claim at two lengths, and changing one without the other is what F01 was.
 */
export const LOCATION_POLICY_LINK = Object.freeze({
  href: "/privacy",
  label: "How we use location",
});
