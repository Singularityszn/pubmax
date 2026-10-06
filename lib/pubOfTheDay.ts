// WHAT EARNS THE DAILY EDITORIAL CARD, AND WHAT IS REFUSED.
//
// Astra F08 (6 Sep 2026): "Pub of the day" printed "Sun Inn" over the sentence
// "pub in Barnes, London, UK", stamped it Sourced, and offered one link, out to
// Wikipedia. Every word of it was true and none of it was a reason to go. It
// was a Wikidata DESCRIPTION, which exists to disambiguate an entity, doing the
// job of an editorial pick.
//
// Three separate faults sat behind that one card, and each gets its own rule
// here:
//
//   1. NO CONTENT TEST. Any sourced sentence qualified, so a classification
//      qualified. `taxonomy-only` and `unnamed-subject` are the refusals for
//      that: a sentence has to say something checkable about this building AND
//      name the pub it is about.
//   2. NO VENUE IDENTITY. The pick was keyed on a pub NAME read out of
//      heritage_cache.json, and London has several pubs of nearly every name.
//      The card is now built from the JOINED historic index, which carries the
//      venue id the map link needs, and a row with no id is refused.
//   3. NO WAY IN. The only action was a link off the site. A pub of the day a
//      reader cannot open is a magazine page, not a product.
//
// It is a GATE, not a rewriter: it never edits a sentence, it refuses one and
// names the class it belongs to, so the fix is made at the source record by a
// person. An empty eligible set is not a failure either: the card falls back to
// its "still in the archive" state, which is the honest thing to say.
//
// Pure and node-testable: no fs, no clock of its own (every function takes
// `now`), and the day rotation is the London calendar day so every visitor on a
// given day sees the same pub.

import type { Route } from "next";
import { isFeaturedHeritageSource, type HeritageFact } from "@/lib/heritageFacts";
import { internalLanguageFindings } from "@/lib/heritageLanguageGate.mjs";
import { heritagePlaceConflict } from "@/lib/heritagePlaceConflict.mjs";
import { heritageSourceLabel } from "@/lib/historicFilter";
import type { Provenance } from "@/lib/curation";
import { PROVENANCE_LABEL } from "@/lib/provenanceLabels";
import { venueMapUrl } from "@/lib/venueMapUrl";

/** The subset of a joined historic-pub row this card needs. */
export type PubOfTheDayCandidate = {
  /** The joined venue id. Null means the record matched no venue. */
  venueId: string | null;
  name: string;
  slug: string;
  /** The venue row's borough: the geographic authority for the join. */
  borough: string | null;
  facts: readonly HeritageFact[];
  /** Set only when the sources say the venue is gone. */
  venueStatus?: "closed" | "demolished" | null;
};

export type PubOfTheDayCard = {
  venueId: string;
  pubName: string;
  slug: string;
  /** The sourced sentence that says why this pub is worth knowing. */
  reason: string;
  provenance: Provenance;
  provenanceLabel: string;
  /** Readable source brand for the citation, e.g. "Wikipedia". */
  sourceLabel: string;
  sourceRef: string | null;
  /** The ONE internal action: this pub, on the map. */
  mapHref: Route;
  /** Which markers earned the sentence its place. Diagnostics, never printed. */
  markers: PubOfTheDayMarkerId[];
};

// ── What makes a sentence a reason ───────────────────────────────────────

export type PubOfTheDayMarkerId =
  | "stated-date"
  | "statutory-listing"
  | "named-association";

/**
 * The closed table of specificity markers. A sentence needs at least one.
 *
 * Each marker is a CHECKABLE claim about this building that a category and a
 * postcode cannot supply: when it was built, that the state listed it, or what
 * it is known for. Deliberately narrow, because a table that also admits
 * "pub in Barnes, London, UK" admits everything.
 */
const PUB_OF_THE_DAY_MARKERS: readonly {
  id: PubOfTheDayMarkerId;
  why: string;
  pattern: RegExp;
}[] = Object.freeze([
  {
    id: "stated-date",
    why: "states when the pub or its building dates from",
    pattern:
      /\b1[0-9]{3}\b|\b20[0-2][0-9]\b|\b(?:medieval|Georgian|Victorian|Edwardian|Tudor|Stuart|Jacobean)\b|\b\d{1,2}(?:st|nd|rd|th)[- ]century\b/i,
  },
  {
    id: "statutory-listing",
    why: "states a statutory listing, which is a public record about this building",
    pattern:
      /\bgrade\s+(?:i|ii|iii)\*?\s+listed\b|\bheritage[- ]listed\b|\blisted building\b/i,
  },
  {
    id: "named-association",
    why: "names what this pub is known for, rather than what kind of thing it is",
    pattern:
      /\bone of the\b|\breputed\b|\bassociated with\b|\bnamed (?:after|for)\b|\bknown for\b|\bworld record\b|\bfrequented by\b|\bhome to\b|\bthe oldest\b|\bthe first\b|\bestablished\b|\bfounded\b|\brebuilt\b|\bdesigned by\b|\bbuilt by\b/i,
  },
]);

/** Every marker a sentence carries, in table order. */
export function pubOfTheDayMarkers(text: string): PubOfTheDayMarkerId[] {
  const haystack = String(text ?? "");
  if (!haystack.trim()) return [];
  return PUB_OF_THE_DAY_MARKERS.filter((marker) =>
    marker.pattern.test(haystack),
  ).map((marker) => marker.id);
}

// ── What is refused ──────────────────────────────────────────────────────

type PubOfTheDayRefusalId =
  | "unresolved-venue"
  | "venue-gone"
  | "no-sourced-fact"
  | "internal-language"
  | "place-conflict"
  | "dangling-reference"
  | "unnamed-subject"
  | "taxonomy-only";

export type PubOfTheDayRefusal = { id: PubOfTheDayRefusalId; why: string };

/**
 * Compare a name and a sentence the way a reader does, not the way a string
 * does: case, punctuation, spacing and an ampersand all stop mattering, so
 * "The Dog & Duck" is found inside "The Dog and Duck at 18 Bateman Street".
 */
function comparable(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * The pub's own name, without a leading article and without the disambiguator
 * a source title appends ("Slug and Lettuce, Islington").
 */
function nameKey(name: string): string {
  const base = String(name ?? "").split(",")[0] ?? "";
  return comparable(base.replace(/^\s*(?:the|ye)\s+/i, ""));
}

/**
 * Whether the sentence is about THIS pub by name.
 *
 * A Wikipedia extract opens with the pub ("The Grenadier is a Grade II listed
 * pub tucked down Wilton Row"). A Wikidata description never does, because it
 * exists to be read BESIDE the name it describes, on a page that already says
 * which entity is meant. Lifted onto a card, that sentence has no subject, and
 * a card whose sentence has no subject is how "Upper Flask / 18th-century
 * tavern in Hampstead" reached a reader over a venue of that name which is not
 * the tavern the sentence is about. The name is the cheapest deterministic
 * proof that the words and the venue are about one pub.
 */
function namesItsSubject(name: string, text: string): boolean {
  const key = nameKey(name);
  if (key.length < 3) return false;
  return comparable(text).includes(key);
}

/**
 * A sentence that points at something we do not publish beside it.
 *
 * Wikidata descriptions are written inside a page, so "designed by the above"
 * is a complete sentence there and a dead end here. There is nothing to fix in
 * the wording: the reference has no referent on our card.
 */
const DANGLING_REFERENCE =
  /\bthe above\b|\bsee above\b|\bas above\b|\bibid\b|\bthis article\b/i;

/**
 * The closure phrases a record's own prose may carry.
 *
 * `venueStatus` is the structured answer and is checked first; this is the
 * unstructured half, kept because a Wikidata description says "former pub" far
 * more often than the index carries a status. High-precision only: an OPEN pub
 * described as a "former coaching inn" names a past ROLE, not a closure, so
 * every phrase pairs the closure word with the venue word.
 */
const CLOSURE_MARKERS: readonly string[] = [
  "former pub",
  "former public house",
  "former bar",
  "closed pub",
  "now closed",
  "closed down",
  "closed permanently",
  "permanently closed",
  "no longer a pub",
  "demolished",
];

function signalsClosure(text: string): boolean {
  const haystack = text.toLowerCase();
  return CLOSURE_MARKERS.some((marker) => haystack.includes(marker));
}

// Prefer the most readable attributable source, exactly as the historic index
// does. Seed material is excluded before this runs.
const SOURCE_PRIORITY: readonly HeritageFact["source"][] = [
  "wikipedia",
  "nhle",
  "wikidata",
  "osm",
];

function sourcePriority(source: HeritageFact["source"]): number {
  const index = SOURCE_PRIORITY.indexOf(source);
  return index === -1 ? SOURCE_PRIORITY.length : index;
}

export type PubOfTheDayVerdict =
  | { ok: true; card: PubOfTheDayCard }
  | { ok: false; refusal: PubOfTheDayRefusal };

/**
 * Judge one candidate. The order is the rule.
 *
 * Identity first, because a card about the wrong pub is worse than no card.
 * Then whether the place still exists. Then whether we hold a sourced sentence
 * at all, then whether that sentence may be published (internal language, a
 * borough that contradicts the join, a reference with no referent), and only
 * last whether it says anything specific.
 */
export function judgePubOfTheDay(
  candidate: PubOfTheDayCandidate,
): PubOfTheDayVerdict {
  const refuse = (id: PubOfTheDayRefusalId, why: string): PubOfTheDayVerdict => ({
    ok: false,
    refusal: { id, why },
  });

  const venueId = candidate.venueId?.trim();
  if (!venueId) {
    return refuse(
      "unresolved-venue",
      "the record matched no venue, so the card could send a reader to the wrong pub",
    );
  }
  if (candidate.venueStatus) {
    return refuse(
      "venue-gone",
      `the index records this venue as ${candidate.venueStatus}`,
    );
  }
  if (signalsClosure(candidate.name)) {
    return refuse("venue-gone", "the pub's own name says it is former or closed");
  }

  const sourced = (candidate.facts ?? []).filter((fact) =>
    isFeaturedHeritageSource(fact.source),
  );
  const best = [...sourced].sort(
    (a, b) => sourcePriority(a.source) - sourcePriority(b.source),
  )[0];
  if (!best) {
    return refuse(
      "no-sourced-fact",
      "nothing here is attributable: seed material is not a sourced claim",
    );
  }
  if (sourced.some((fact) => signalsClosure(fact.fact))) {
    return refuse("venue-gone", "a source describes this pub as former or closed");
  }

  const reason = best.fact.trim();

  const internal = internalLanguageFindings(reason)[0];
  if (internal) {
    return refuse("internal-language", `the sentence ${internal.why}`);
  }

  const conflict = heritagePlaceConflict({
    text: reason,
    sourceRef: best.sourceRef ?? null,
    venueBorough: candidate.borough ?? null,
  });
  if (conflict) {
    return refuse("place-conflict", conflict.why);
  }

  if (DANGLING_REFERENCE.test(reason)) {
    return refuse(
      "dangling-reference",
      "the sentence points at context we do not publish beside it",
    );
  }

  if (!namesItsSubject(candidate.name, reason)) {
    return refuse(
      "unnamed-subject",
      "the sentence never names this pub, so it was written to be read beside a name rather than about this venue",
    );
  }

  const markers = pubOfTheDayMarkers(reason);
  if (markers.length === 0) {
    return refuse(
      "taxonomy-only",
      "the sentence names a category and a place, which is not a reason to go",
    );
  }

  const provenance: Provenance = "sourced";
  return {
    ok: true,
    card: {
      venueId,
      pubName: candidate.name,
      slug: candidate.slug,
      reason,
      provenance,
      provenanceLabel: PROVENANCE_LABEL[provenance],
      sourceLabel: heritageSourceLabel(best.source),
      sourceRef: best.sourceRef ?? null,
      mapHref: venueMapUrl(venueId),
      markers,
    },
  };
}

const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * Stable per-London-day integer (days since epoch), so the pick rotates once a
 * day and is identical for every visitor on that calendar day.
 */
function londonDayIndex(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return Math.floor(Date.UTC(get("year"), get("month") - 1, get("day")) / DAY_MS);
}

/**
 * The day's card, or null when nothing in the set earns one.
 *
 * Every refusal runs BEFORE the rotation, so the pick falls deterministically
 * through to the next eligible pub rather than leaving a hole on the days the
 * refused ones would have had.
 */
export function pickPubOfTheDay(
  candidates: readonly PubOfTheDayCandidate[],
  now: Date,
): PubOfTheDayCard | null {
  const eligible: PubOfTheDayCard[] = [];
  for (const candidate of candidates ?? []) {
    const verdict = judgePubOfTheDay(candidate);
    if (verdict.ok) eligible.push(verdict.card);
  }
  eligible.sort(
    (a, b) => a.pubName.localeCompare(b.pubName) || a.slug.localeCompare(b.slug),
  );
  return eligible[londonDayIndex(now) % eligible.length] ?? null;
}

/**
 * Why each candidate was refused, for a person fixing the source record. Never
 * rendered.
 */
export function pubOfTheDayRefusals(
  candidates: readonly PubOfTheDayCandidate[],
): { name: string; refusal: PubOfTheDayRefusal }[] {
  const refusals: { name: string; refusal: PubOfTheDayRefusal }[] = [];
  for (const candidate of candidates ?? []) {
    const verdict = judgePubOfTheDay(candidate);
    if (!verdict.ok) refusals.push({ name: candidate.name, refusal: verdict.refusal });
  }
  return refusals;
}
