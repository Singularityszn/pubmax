// The Wikidata history pack: what Wikidata (CC0) states about the London pub
// items OSM names in its `wikidata` tag (public/data/osm_wikidata/london.json).
//
// ONE SOURCE PER PACK, AND ONLY STATEMENTS. Every value is a Wikidata
// statement on the item itself, carried with its property id so the sheet can
// link the exact statement. Nothing is summarised, translated into a claim the
// statement does not make, or filled in: an item with no statement in the
// closed set below gets no row, and no row is never "no history".
//
// NEVER A BRAND. The read keeps an item only when Wikidata types it as a pub
// (P31/P279* Q212198) and not as a brand (Q431289), so a chain's item that an
// OSM pub mis-tags never lends the chain's founding year to one building.

import { openDataSourceUrl } from "../../lib/harvest/sourcePolicy.ts";

export const WIKIDATA_HISTORY_PACK_VERSION = 1;

export const WIKIDATA_SOURCE = Object.freeze({
  source: "Wikidata",
  sourceUrl: "https://www.wikidata.org/",
  license: "CC0 1.0",
  licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
});

/** The statements a row may carry, in the order the sheet prints them. */
export const HISTORY_PROPERTIES = Object.freeze(["P571", "P1435", "P149", "P84"]);

const PUB_CLASS = "Q212198";
const BRAND_CLASS = "Q431289";

/** The SPARQL that reads one batch of items. Exported so the test pins its fences. */
export function historyQuery(qids) {
  const values = qids.map((qid) => `wd:${qid}`).join(" ");
  return `SELECT ?item ?prop ?value ?valueLabel ?precision WHERE {
  VALUES ?item { ${values} }
  ?item wdt:P31/wdt:P279* wd:${PUB_CLASS} .
  FILTER NOT EXISTS { ?item wdt:P31 wd:${BRAND_CLASS} . }
  {
    ?item p:P571 ?statement .
    ?statement wikibase:rank ?rank .
    FILTER(?rank != wikibase:DeprecatedRank)
    ?statement psv:P571 [ wikibase:timeValue ?value ; wikibase:timePrecision ?precision ] .
    BIND("P571" AS ?prop)
  }
  UNION { ?item wdt:P1435 ?value . BIND("P1435" AS ?prop) }
  UNION { ?item wdt:P149 ?value . BIND("P149" AS ?prop) }
  UNION { ?item wdt:P84 ?value . BIND("P84" AS ?prop) }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
}

/**
 * A Wikidata time at its own precision, never finer: 9 is a year ("1520"),
 * 8 a decade ("1520s"), 7 a century ("16th century"). Anything finer is read
 * as the year, and anything coarser, or a date before year 1, is not carried.
 */
export function timeAtPrecision(value, precision) {
  const match = /^\+?(\d{1,4})-\d{2}-\d{2}T/.exec(String(value ?? ""));
  const level = Number(precision);
  if (!match || !Number.isInteger(level)) return null;
  const year = Number(match[1]);
  if (year < 1) return null;
  if (level >= 9) return String(year);
  if (level === 8) return `${Math.floor(year / 10) * 10}s`;
  if (level === 7) {
    const century = Math.floor((year - 1) / 100) + 1;
    const suffix = century % 100 >= 11 && century % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][century % 10] ?? "th";
    return `${century}${suffix} century`;
  }
  return null;
}

function qidOf(uri) {
  const match = /\/entity\/(Q[1-9]\d*)$/.exec(String(uri ?? ""));
  return match ? match[1] : null;
}

/** One SPARQL binding as `[qid, [property, value]]`, or null when it states nothing usable. */
export function compactBinding(binding) {
  const qid = qidOf(binding?.item?.value);
  const prop = binding?.prop?.value;
  if (!qid || !HISTORY_PROPERTIES.includes(prop)) return null;
  if (prop === "P571") {
    const when = timeAtPrecision(binding.value?.value, binding.precision?.value);
    return when ? [qid, [prop, when]] : null;
  }
  const label = typeof binding.valueLabel?.value === "string" ? binding.valueLabel.value.trim() : "";
  // An item with no English label comes back as its own id: not a statement a reader can read.
  if (!label || /^Q\d+$/.test(label)) return null;
  return [qid, [prop, label]];
}

/** The QIDs the OSM link pack names. */
export function wantedQids(linksPack) {
  const wanted = new Set();
  for (const link of Array.isArray(linksPack?.links) ? linksPack.links : []) {
    if (Array.isArray(link) && typeof link[1] === "string" && /^Q[1-9]\d*$/.test(link[1])) wanted.add(link[1]);
  }
  return wanted;
}

/** Assemble the pack from every binding the reads returned. */
export function buildWikidataHistoryPack({ wanted, bindings, retrievedAt }) {
  if (!Number.isFinite(Date.parse(retrievedAt))) throw new Error("retrievedAt must be a date");
  const byQid = new Map();
  for (const binding of bindings) {
    const compact = compactBinding(binding);
    if (!compact || !wanted.has(compact[0])) continue;
    const [qid, fact] = compact;
    const facts = byQid.get(qid) ?? [];
    if (!facts.some((existing) => existing[0] === fact[0] && existing[1] === fact[1])) facts.push(fact);
    byQid.set(qid, facts);
  }
  const items = {};
  for (const qid of [...byQid.keys()].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) {
    items[qid] = byQid
      .get(qid)
      .sort((a, b) => HISTORY_PROPERTIES.indexOf(a[0]) - HISTORY_PROPERTIES.indexOf(b[0]) || (a[1] < b[1] ? -1 : 1));
  }
  return {
    version: WIKIDATA_HISTORY_PACK_VERSION,
    ...WIKIDATA_SOURCE,
    retrievedAt,
    counts: { wanted: wanted.size, withHistory: byQid.size },
    items,
  };
}

/** The Wikidata Query Service's row in lib/harvest/sourceRegistry.ts. */
const WIKIDATA_SOURCE_POLICY_ID = "wikidata-query-service";
const USER_AGENT = "PubmaxxingWikidataHistory/1.0 (https://pubmaxxing.com/credits)";
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/**
 * Run one SPARQL query against the Wikidata Query Service and return its
 * bindings.
 *
 * THE SOURCE POLICY OWNS THE HOST: the URL comes from `openDataSourceUrl`
 * (lib/harvest/sourcePolicy.ts, row `wikidata-query-service` in
 * lib/harvest/sourceRegistry.ts) plus the query, and a redirect is an error, so
 * no response from another host is ever read. The
 * service asks for a descriptive User-Agent, which this sends. A 429 or a 5xx
 * is asked again after the service's `Retry-After` (or a doubling wait from
 * `baseDelayMs`), at most `maxAttempts` times in all; any other failure throws,
 * so a partial read never ships.
 */
export async function wikidataSparqlRead(
  query,
  { fetchImpl = fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), maxAttempts = 5, baseDelayMs = 2000 } = {},
) {
  const url = openDataSourceUrl(WIKIDATA_SOURCE_POLICY_ID, `?format=json&query=${encodeURIComponent(query)}`).href;
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetchImpl(url, {
      headers: { accept: "application/sparql-results+json", "user-agent": USER_AGENT },
      redirect: "error",
    });
    if (response.ok) {
      const body = await response.json();
      return Array.isArray(body?.results?.bindings) ? body.results.bindings : [];
    }
    if (!RETRYABLE.has(response.status) || attempt >= maxAttempts) {
      throw new Error(`Wikidata ${response.status} after ${attempt} attempt(s)`);
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : baseDelayMs * 2 ** (attempt - 1));
  }
}
