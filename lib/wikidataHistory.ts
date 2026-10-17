// The runtime join behind a pub's Wikidata history: an OSM pub's own
// `wikidata` tag (public/data/osm_wikidata/london.json, ODbL) meets the
// statements Wikidata holds on that item (public/data/wikidata_history/
// london.json, CC0).
//
// THE JOIN IS EXACT AND THE WORDS ARE CLOSED. A venue reaches an item only
// through the tag OSM states for it, never by its name, and each statement is
// printed through one fixed template that says what Wikidata records and no
// more ("Inception recorded as 1520."), with a link to that statement and the
// day the pack was read. A missing link, item or pack answers nothing.

import type { HeritageFact } from "@/lib/heritageFacts";

export type OsmWikidataLinks = {
  fetchedAt: string;
  qidByRef: ReadonlyMap<string, string>;
  refByVenueId: ReadonlyMap<string, string>;
};

export type WikidataHistory = {
  retrievedAt: string;
  byQid: ReadonlyMap<string, ReadonlyArray<readonly [string, string]>>;
};

const TEMPLATES: Readonly<Record<string, (value: string) => string>> = {
  P571: (value) => `Inception recorded as ${value}.`,
  P1435: (value) => `Heritage designation recorded as ${value}.`,
  P149: (value) => `Architectural style recorded as ${value}.`,
  P84: (value) => `Architect recorded as ${value}.`,
};

const QID = /^Q[1-9]\d{0,11}$/;

function isDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/** Guard the OSM link pack; null when it is not one. */
export function parseOsmWikidataLinks(raw: unknown): OsmWikidataLinks | null {
  const file = raw as { version?: unknown; fetchedAt?: unknown; links?: unknown } | null;
  if (!file || file.version !== 1 || !isDate(file.fetchedAt) || !Array.isArray(file.links)) return null;
  const qidByRef = new Map<string, string>();
  const refByVenueId = new Map<string, string>();
  for (const link of file.links) {
    if (!Array.isArray(link)) continue;
    const [ref, qid, venueId] = link as unknown[];
    if (typeof ref !== "string" || !/^[nwr][1-9]\d*$/.test(ref)) continue;
    if (typeof qid !== "string" || !QID.test(qid)) continue;
    qidByRef.set(ref, qid);
    if (typeof venueId === "string" && venueId) refByVenueId.set(venueId, ref);
  }
  return { fetchedAt: file.fetchedAt, qidByRef, refByVenueId };
}

/** Guard the history pack; null when it is not one. */
export function parseWikidataHistory(raw: unknown): WikidataHistory | null {
  const file = raw as { version?: unknown; retrievedAt?: unknown; license?: unknown; items?: unknown } | null;
  if (!file || file.version !== 1 || !isDate(file.retrievedAt) || file.license !== "CC0 1.0") return null;
  if (!file.items || typeof file.items !== "object" || Array.isArray(file.items)) return null;
  const byQid = new Map<string, ReadonlyArray<readonly [string, string]>>();
  for (const [qid, facts] of Object.entries(file.items as Record<string, unknown>)) {
    if (!QID.test(qid) || !Array.isArray(facts)) continue;
    const kept: Array<readonly [string, string]> = [];
    for (const fact of facts) {
      if (!Array.isArray(fact)) continue;
      const [property, value] = fact as unknown[];
      if (typeof property !== "string" || !(property in TEMPLATES)) continue;
      if (typeof value !== "string" || !value.trim()) continue;
      kept.push([property, value.trim()]);
    }
    if (kept.length) byQid.set(qid, kept);
  }
  return { retrievedAt: file.retrievedAt, byQid };
}

/** The Wikidata item a venue id names: a base pub's own tag, or a curated pub's link. */
export function qidForVenueId(venueId: string, links: OsmWikidataLinks): string | null {
  const base = /^venue-uk-([nwr][1-9]\d*)$/.exec(venueId);
  const ref = base ? base[1] : links.refByVenueId.get(venueId);
  return ref ? links.qidByRef.get(ref) ?? null : null;
}

/** The pub's Wikidata history as dated, cited heritage facts, or []. */
export function wikidataHistoryForVenue(
  venueId: string,
  links: OsmWikidataLinks | null,
  history: WikidataHistory | null,
): HeritageFact[] {
  if (!links || !history) return [];
  const qid = qidForVenueId(venueId, links);
  const facts = qid ? history.byQid.get(qid) : undefined;
  if (!qid || !facts) return [];
  return facts.map(([property, value]) => ({
    source: "wikidata" as const,
    fact: TEMPLATES[property]!(value),
    sourceRef: `https://www.wikidata.org/wiki/${qid}#${property}`,
    observedAt: history.retrievedAt,
  }));
}
