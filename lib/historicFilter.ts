// Historic Pubs — the pure, React-free filter + sort core behind the /historic
// discovery surface. Extracted so the ordering rules (especially the mixed
// year-vs-century "oldest first" comparison) can be unit-tested without a DOM.
//
// Provenance contract: this module only ever reads, filters, and reorders the
// records loaded by lib/historic — it never fabricates a field. The citation
// helpers below derive a link + label strictly from the data's own sourceRefs.

import type { HeritageFact } from "@/lib/heritage";
import type { HistoricPub, HistoricVenueStatus } from "@/lib/historic";

type HistoricSort = "oldest" | "az" | "borough";

export type HistoricFilters = {
  /** Exact borough match; null = every borough. */
  borough: string | null;
  /** Only pubs carrying a listed-building grade. */
  listedOnly: boolean;
  /** Only pubs with an extracted era/date. */
  hasDate: boolean;
  sort: HistoricSort;
};

// Map an era string to a comparable *start year* for "oldest first".
//   - a plain 3–4 digit year ("1520", "1667")      → that year
//   - "Nth century" ("17th century")               → (N-1)*100, i.e. its start
//   - anything unparseable, and null               → +Infinity (sorts last)
// So a dated pub "1520" (1520) precedes "17th century" (1600) precedes "18th
// century" (1700) precedes a null-era pub — matching the required ordering.
// Centuries are ranked by their opening year so a specific 16th-century year
// still slots ahead of the generic "17th century".
export function eraStartYear(era: string | null): number {
  if (!era) return Number.POSITIVE_INFINITY;
  const century = era.match(/(\d{1,2})\s*(?:st|nd|rd|th)\s*century/i);
  if (century) {
    const n = Number(century[1]);
    if (Number.isFinite(n) && n > 0) return (n - 1) * 100;
  }
  const year = era.match(/\d{3,4}/);
  if (year) {
    const n = Number(year[0]);
    if (Number.isFinite(n)) return n;
  }
  return Number.POSITIVE_INFINITY;
}

/** The distinct boroughs actually present, A–Z. Nulls dropped. */
export function availableBoroughs(pubs: HistoricPub[]): string[] {
  const set = new Set<string>();
  for (const pub of pubs) {
    if (pub.borough) set.add(pub.borough);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Human label for a listed grade, e.g. "II*" → "Grade II*". null → null. */
export function listedBadge(listed: string | null): string | null {
  return listed ? `Grade ${listed}` : null;
}

/** Venue lifecycle badge from stored status only — never guessed from hook text. */
export function venueStatusBadge(
  status: HistoricVenueStatus | null | undefined,
): string | null {
  if (status === "closed") return "Closed";
  if (status === "demolished") return "Demolished";
  return null;
}

// Canonical human label for a heritage fact's `source`, shared by every heritage
// surface (the map venue sheet + /historic) so the chip reads identically
// everywhere. Named public sources get their real brand; our own seed curation
// and any unrecognised token degrade to the honest generic "On record" rather
// than leaking a raw source value. A pure string→string map — safe in both
// client and server components. Needs a different case somewhere? Use CSS
// text-transform, not a divergent copy of this function.
export function heritageSourceLabel(source: string): string {
  switch (source) {
    case "wikipedia":
      return "Wikipedia";
    case "wikidata":
      return "Wikidata";
    case "osm":
      return "OpenStreetMap";
    case "nhle":
      return "Historic England";
    case "web":
      return "Web";
    case "seed":
    default:
      return "On record";
  }
}

// The citation for a pub's hook. Prefer the sourceRef of the first fact whose
// text *is* the hook (the hook is lifted verbatim from a cited fact); fall back
// to the first wikipedia fact with a ref, then to any fact with a ref. Returns
// null when nothing in the record carries a link — never a fabricated URL.
export function citationHref(pub: HistoricPub): string | null {
  const exact = pub.facts.find((f) => f.fact === pub.hook && f.sourceRef);
  if (exact?.sourceRef) return exact.sourceRef;
  const wiki = pub.facts.find((f) => f.source === "wikipedia" && f.sourceRef);
  if (wiki?.sourceRef) return wiki.sourceRef;
  const any = pub.facts.find((f) => f.sourceRef);
  return any?.sourceRef ?? null;
}

// THE RECORD SAYS EACH THING ONCE. A pub's cited facts arrive from several
// sources that often describe the same thing: Prospect of Whitby carried the
// Wikipedia lead (which is already the page's intro), a seed line saying the
// same date, and a Wikidata one-liner. The record drops a fact that repeats the
// intro, and of two facts where one is substantially contained in the other it
// keeps the fuller one. "Contained" is a normalised substring, or at least
// RECORD_TOKEN_CONTAINMENT of the shorter fact's content words (lightly
// stemmed, stop words out) appearing in the longer one. Nothing is reworded:
// a kept fact is printed verbatim with its own source.
const RECORD_TOKEN_CONTAINMENT = 0.8;

const RECORD_STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "was", "were", "has", "had",
  "its", "one", "are", "but", "not", "into", "onto", "upon", "also", "which", "who",
  "around", "about", "near", "than", "then", "there", "their", "his", "her", "been",
]);

function normaliseRecordText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stemRecordToken(token: string): string {
  let stem = token;
  for (const suffix of ["ing", "ed", "es", "ly", "s"]) {
    if (stem.endsWith(suffix) && stem.length - suffix.length >= 3) {
      stem = stem.slice(0, -suffix.length);
      break;
    }
  }
  return stem.length > 3 && stem.endsWith("e") ? stem.slice(0, -1) : stem;
}

function recordTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const word of normaliseRecordText(text).split(" ")) {
    if (word.length < 3 || RECORD_STOP_WORDS.has(word)) continue;
    tokens.add(stemRecordToken(word));
  }
  return tokens;
}

/** True when `inner` says nothing `outer` does not already say. */
export function recordTextContainedIn(inner: string, outer: string): boolean {
  const a = normaliseRecordText(inner);
  const b = normaliseRecordText(outer);
  if (!a || !b) return false;
  if (b.includes(a)) return true;
  const innerTokens = recordTokens(inner);
  if (innerTokens.size === 0) return false;
  const outerTokens = recordTokens(outer);
  let shared = 0;
  for (const token of innerTokens) if (outerTokens.has(token)) shared += 1;
  return shared / innerTokens.size >= RECORD_TOKEN_CONTAINMENT;
}

export type HistoricRecord = {
  /** The facts the record prints, in their original order. */
  facts: HeritageFact[];
  /**
   * The cited fact the intro repeats, so its source can still be named once
   * the duplicate leaves the list. Null when no fact repeats the intro.
   */
  introSource: HeritageFact | null;
};

/** The pub's record with the intro and near-duplicate facts taken out. */
export function historicRecord(pub: Pick<HistoricPub, "hook" | "facts">): HistoricRecord {
  const hook = pub.hook?.trim() ?? "";
  const hookText = normaliseRecordText(hook);
  let introSource: HeritageFact | null = null;
  const candidates: { fact: HeritageFact; index: number }[] = [];
  for (const [index, fact] of pub.facts.entries()) {
    if (!hook || !recordTextContainedIn(fact.fact, hook)) {
      candidates.push({ fact, index });
      continue;
    }
    // The fact that IS the intro names its source, ahead of one it contains.
    const isIntro = normaliseRecordText(fact.fact) === hookText;
    if (!introSource || (isIntro && normaliseRecordText(introSource.fact) !== hookText)) {
      introSource = fact;
    }
  }

  // Fuller facts first, so a short fact is measured against the longer one
  // that may already say it; the survivors go back into the record's order.
  const kept: { fact: HeritageFact; index: number }[] = [];
  for (const candidate of [...candidates].sort(
    (left, right) => right.fact.fact.length - left.fact.fact.length || left.index - right.index,
  )) {
    if (kept.some((other) => recordTextContainedIn(candidate.fact.fact, other.fact.fact))) continue;
    kept.push(candidate);
  }
  kept.sort((left, right) => left.index - right.index);
  return { facts: kept.map((entry) => entry.fact), introSource };
}

// A short, honest label for a citation link, derived from its host rather than
// assumed — most refs are Wikipedia, but some point at Wikidata/CAMRA/WhatPub,
// and we name what we actually link to.
export function citationLabel(href: string): string {
  let host = "";
  try {
    host = new URL(href).host.replace(/^www\./, "");
  } catch {
    return "Source";
  }
  if (host.includes("wikipedia.org")) return "Wikipedia";
  if (host.includes("wikidata.org")) return "Wikidata";
  if (host.includes("camra.org.uk")) return "CAMRA";
  if (host.includes("whatpub.com")) return "WhatPub";
  return host;
}

// Filter, then order. Pure: returns a new array, never mutates the input.
// Ordering always breaks ties by name (A–Z) so the result is deterministic.
export function filterAndSortHistoric(
  pubs: HistoricPub[],
  filters: HistoricFilters,
): HistoricPub[] {
  const filtered = pubs.filter((pub) => {
    if (filters.borough && pub.borough !== filters.borough) return false;
    if (filters.listedOnly && !pub.listed) return false;
    if (filters.hasDate && !pub.era) return false;
    return true;
  });

  const sorted = filtered.slice();
  switch (filters.sort) {
    case "az":
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "borough":
      sorted.sort((a, b) => {
        // Undated-borough pubs (null borough) sink to the bottom.
        if (!a.borough && b.borough) return 1;
        if (a.borough && !b.borough) return -1;
        const byBorough = (a.borough ?? "").localeCompare(b.borough ?? "");
        if (byBorough !== 0) return byBorough;
        return a.name.localeCompare(b.name);
      });
      break;
    case "oldest":
    default: {
      sorted.sort((a, b) => {
        const ya = eraStartYear(a.era);
        const yb = eraStartYear(b.era);
        if (ya !== yb) return ya - yb;
        return a.name.localeCompare(b.name);
      });
      break;
    }
  }
  return sorted;
}
