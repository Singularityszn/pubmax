import { runLevelFailure } from "../../lib/cityEnrichmentCheckpoint.ts";
import { isHarvestableOperatorUrl } from "../../lib/harvest/sourcePolicy.ts";
import { extractPintPrices } from "../../lib/harvest/tavilyPintPrices.ts";

import { classifyChainPub, hostMatches, hostnameOf, isChainHost } from "./chainPubClassifier.mjs";

export { classifyChainPub, extractPintPrices };

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const MAX_TAVILY_CALLS_PER_RUN = 200;
// The money ceiling, held in code beside the query ceiling. An advanced search
// costs 2 Tavily credits, so 200 queries is 400 credits; at the $0.008 pay as
// you go price that is $3.20 a run. If the provider ever bills a search at more
// than 2 credits the credit ceiling stops the run before the query ceiling
// does, so the spend can never grow by a pricing change alone.
export const TAVILY_CREDITS_PER_SEARCH = 2;
export const MAX_TAVILY_CREDITS_PER_RUN = MAX_TAVILY_CALLS_PER_RUN * TAVILY_CREDITS_PER_SEARCH;

export const CITY_DEFINITIONS = Object.freeze({
  // London is the city the product is about and was the one city the rotation
  // never held, so no London pub had ever been through this seam. The bbox is
  // Greater London and it is used only to SELECT candidates out of the UK OSM
  // pack; it makes no claim about which borough a pub is in.
  london: {
    id: "london",
    displayName: "London",
    bbox: [51.28, -0.53, 51.7, 0.34],
  },
  manchester: {
    id: "manchester",
    displayName: "Manchester",
    bbox: [53.38, -2.35, 53.55, -2.1],
  },
  birmingham: {
    id: "birmingham",
    displayName: "Birmingham",
    bbox: [52.38, -2.03, 52.57, -1.73],
  },
  edinburgh: {
    id: "edinburgh",
    displayName: "Edinburgh",
    bbox: [55.88, -3.35, 56.0, -3.05],
  },
  glasgow: {
    id: "glasgow",
    displayName: "Glasgow",
    bbox: [55.82, -4.35, 55.9, -4.15],
  },
  leeds: {
    id: "leeds",
    displayName: "Leeds",
    bbox: [53.72, -1.68, 53.9, -1.38],
  },
  bristol: {
    id: "bristol",
    displayName: "Bristol",
    bbox: [51.42, -2.65, 51.5, -2.52],
  },
});

const FORBIDDEN_DISCOVERY_DOMAINS = [
  "beerintheevening.com",
  "camra.org.uk",
  "designmynight.com",
  "facebook.com",
  "foursquare.com",
  "google.com",
  "instagram.com",
  "opentable.co.uk",
  "restaurantguru.com",
  "squaremeal.co.uk",
  "thefork.co.uk",
  "tripadvisor.co.uk",
  "tripadvisor.com",
  "untappd.com",
  "useyourlocal.com",
  "whatpub.com",
  "yell.com",
];

export const OFFICIAL_SITE_SOURCE_LICENCE =
  "All rights reserved - first-party publisher of its own pub menu; read-only, attributed price fact.";

function pathnameOf(value) {
  if (!value) return null;
  try {
    return new URL(value).pathname.toLowerCase().replace(/\/+$/, "") || "/";
  } catch {
    return null;
  }
}

function normaliseVenueKeyPart(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function venueKeyForOsmPub(pub) {
  return [
    normaliseVenueKeyPart(pub.name),
    normaliseVenueKeyPart(pub.address),
    Number(pub.lat).toFixed(5),
    Number(pub.lng).toFixed(5),
  ].join("|");
}

export function selectCityPubs(cityId, allPubs) {
  const city = CITY_DEFINITIONS[cityId];
  if (!city) throw new Error(`Unsupported enrichment city "${cityId}".`);
  const [south, west, north, east] = city.bbox;
  return allPubs
    .filter(
      (pub) =>
        Number(pub.lat) >= south &&
        Number(pub.lat) <= north &&
        Number(pub.lng) >= west &&
        Number(pub.lng) <= east,
    )
    .sort((a, b) => {
      const aWebsite = a.website ? 0 : 1;
      const bWebsite = b.website ? 0 : 1;
      const aChain = classifyChainPub(a) ? 1 : 0;
      const bChain = classifyChainPub(b) ? 1 : 0;
      // A pub the curated layer already owns is already covered by the London
      // pipeline, so it goes behind one nobody has looked at. `curatedRef` is
      // written by the UK OSM pack itself; a pack without it simply sorts by
      // the keys below, exactly as before.
      const aCovered = a.curatedRef ? 1 : 0;
      const bCovered = b.curatedRef ? 1 : 0;
      return (
        aWebsite - bWebsite ||
        aChain - bChain ||
        aCovered - bCovered ||
        String(a.name).localeCompare(String(b.name)) ||
        String(a.osmId).localeCompare(String(b.osmId))
      );
    });
}

function isForbiddenHost(host) {
  return FORBIDDEN_DISCOVERY_DOMAINS.some((domain) => hostMatches(host, domain));
}

/** OSM-declared website ownership is the only first-party proof we accept. */
export function isOfficialResult(pub, result) {
  const resultHost = hostnameOf(result?.url);
  if (!resultHost || isForbiddenHost(resultHost)) return false;
  if (isChainHost(resultHost)) return false;

  const declaredHost = hostnameOf(pub?.website);
  return Boolean(
    declaredHost &&
    (hostMatches(resultHost, declaredHost) || hostMatches(declaredHost, resultHost)),
  );
}

/**
 * Keyless shared reader, or the judged batch path when TYPESAFE_API_KEY is set.
 * The model call lives in readPrices.mjs so this module stays free of it until
 * a key is actually present.
 */
export async function extractPintPricesMaybeJudged(markdown, ctx) {
  if (!process.env.TYPESAFE_API_KEY?.trim()) return extractPintPrices(markdown);
  const { extractPintPricesForHarvest } = await import("../harvest/uk-prices/readPrices.mjs");
  const { prices } = await extractPintPricesForHarvest(markdown, ctx);
  return prices;
}

/**
 * Keyless shared reader for every drink category, or the judged batch path when
 * TYPESAFE_API_KEY is set.
 */
export async function extractVenueDrinkPricesMaybeJudged(markdown, ctx) {
  const { extractVenueDrinkPricesForHarvest } = await import("../harvest/uk-prices/readPrices.mjs");
  return extractVenueDrinkPricesForHarvest(markdown, ctx);
}

function canonicalPriceKey(row) {
  return `${row.venueKey}|${String(row.drinkName).toLowerCase()}|${row.category}`;
}

export function mergeCanonicalPrices(existing, incoming) {
  const incomingKeys = new Set(incoming.map(canonicalPriceKey));
  return [
    ...existing.filter((row) => !incomingKeys.has(canonicalPriceKey(row))),
    ...incoming,
  ];
}

function searchQuery(pub) {
  const host = hostnameOf(pub.website);
  return `site:${host} "${pub.name}" drinks menu "pint" "£"`;
}

async function searchTavily({ pub, apiKey, fetchImpl, signal }) {
  const declaredHost = hostnameOf(pub.website);
  const response = await fetchImpl(TAVILY_SEARCH_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    signal,
    body: JSON.stringify({
      query: searchQuery(pub),
      topic: "general",
      search_depth: "advanced",
      chunks_per_source: 3,
      max_results: 10,
      include_answer: false,
      include_images: false,
      include_raw_content: "markdown",
      include_usage: true,
      ...(declaredHost ? { include_domains: [declaredHost] } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(`Tavily search failed (${response.status}) for ${pub.name}.`);
  }
  return response.json();
}

function sourceLabel(pub) {
  return `${String(pub.name).trim()} - official site`;
}

function resultContent(result) {
  return typeof result?.raw_content === "string"
    ? result.raw_content
    : typeof result?.content === "string"
      ? result.content
      : "";
}

function resultMatchesDeclaredVenuePage(pub, result) {
  const declaredPath = pathnameOf(pub.website);
  const resultPath = pathnameOf(result?.url);
  return Boolean(
    declaredPath &&
    declaredPath !== "/" &&
    resultPath &&
    (resultPath === declaredPath || resultPath.startsWith(`${declaredPath}/`)),
  );
}

function isExplicitlyStaleResult(result, observedAt) {
  const observedYear = new Date(observedAt).getUTCFullYear();
  if (!Number.isInteger(observedYear)) return false;
  const years = [...String(result?.url ?? "").matchAll(/(?:^|[/-])(20\d{2})(?=$|[/-])/g)]
    .map((match) => Number(match[1]));
  return years.length > 0 && Math.max(...years) < observedYear - 1;
}

function explicitUrlDateRank(result) {
  const dates = [
    ...String(result?.url ?? "").matchAll(
      /(?:^|[/-])(20\d{2})(?:[/-](0?[1-9]|1[0-2]))?(?=$|[/-])/g,
    ),
  ].map((match) => Number(match[1]) * 100 + Number(match[2] ?? 0));
  return dates.length > 0 ? Math.max(...dates) : null;
}

function countPubsByHost(pubs) {
  const counts = new Map();
  for (const pub of pubs) {
    const host = hostnameOf(pub.website);
    if (host) counts.set(host, (counts.get(host) ?? 0) + 1);
  }
  return counts;
}

function acceptedOfficialResults(pub, payload, hostCounts, observedAt) {
  const declaredHost = hostnameOf(pub.website);
  return (Array.isArray(payload?.results) ? payload.results : []).filter(
    (result) =>
      isOfficialResult(pub, result) &&
      isHarvestableOperatorUrl(result?.url) &&
      !isExplicitlyStaleResult(result, observedAt) &&
      ((hostCounts.get(declaredHost) ?? 0) <= 1 || resultMatchesDeclaredVenuePage(pub, result)),
  );
}

async function selectBestOfficialPage(results, pub) {
  let matchedPage = null;
  for (const result of results) {
    const extracted = await extractPintPricesMaybeJudged(resultContent(result), {
      pubName: pub?.name ?? "Unknown pub",
      pageUrl: result?.url ?? "",
    });
    const dateRank = explicitUrlDateRank(result);
    const existingDateRank = matchedPage?.dateRank ?? null;
    const isNewerDatedPage =
      dateRank !== null &&
      existingDateRank !== null &&
      dateRank > existingDateRank;
    const datesDoNotDecide =
      dateRank === existingDateRank ||
      dateRank === null ||
      existingDateRank === null;
    if (
      !matchedPage ||
      isNewerDatedPage ||
      (datesDoNotDecide && extracted.length > matchedPage.extracted.length)
    ) {
      matchedPage = { result, extracted, dateRank };
    }
  }
  return matchedPage;
}

/**
 * A venue resolved without spending a query: a chain pub the estate harvesters
 * own, or a pub OSM states no website for.
 */
function unsearchableVenue(pub, index) {
  const chain = classifyChainPub(pub);
  if (chain) {
    return { chain, outcome: { index, osmId: pub.osmId, status: "delegated" } };
  }
  if (!hostnameOf(pub.website)) {
    return { chain: null, outcome: { index, osmId: pub.osmId, status: "no-website" } };
  }
  // The source-policy fence stands in front of every harvested URL. A website
  // the policy refuses (a refused estate, our own network, credentials in the
  // URL) is never sent to the provider as a search domain, and no query is spent.
  if (!isHarvestableOperatorUrl(pub.website)) {
    return { chain: null, outcome: { index, osmId: pub.osmId, status: "refused-source" } };
  }
  return null;
}

/** Turn one accepted official page into its provenance rows. */
function recordOfficialPage({ pub, matchedPage, observedAt, pages, prices }) {
  const venueKey = venueKeyForOsmPub(pub);
  pages.push({
    osmId: pub.osmId,
    venueKey,
    pubName: pub.name,
    address: pub.address,
    officialUrl: matchedPage.result.url,
    matchBasis: "osm-website-domain",
    priceCount: matchedPage.extracted.length,
    observedAt,
  });
  for (const price of matchedPage.extracted) {
    prices.push({
      venueKey,
      drinkName: price.drinkName,
      category: "beer",
      priceGbp: price.priceGbp,
      servingSize: price.servingSize,
      source: {
        label: sourceLabel(pub),
        url: matchedPage.result.url,
        licence: OFFICIAL_SITE_SOURCE_LICENCE,
      },
      observedAt,
    });
  }
}

/**
 * One provider call for one pub. Which provider answers is a wiring question,
 * so it lives here rather than inside the run loop, where it read as part of
 * the enrichment rules.
 */
function searchOfficialPage({ pub, searchProvider, apiKey, fetchImpl, observedAt, signal }) {
  const host = hostnameOf(pub.website);
  if (searchProvider) {
    return searchProvider.search({
      query: searchQuery(pub),
      maxResults: 10,
      ...(host ? { includeDomains: [host] } : {}),
      endPublishedDate: observedAt,
      signal,
      timeoutMs: SEARCH_REQUEST_WALL_MS,
    });
  }
  return withRequestDeadline(signal, (requestSignal) =>
    searchTavily({ pub, apiKey, fetchImpl, signal: requestSignal }),
  );
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const error = new Error("City enrichment aborted.");
    error.name = "AbortError";
    throw error;
  }
}

const SEARCH_REQUEST_WALL_MS = 12_000;

async function withRequestDeadline(parentSignal, operation) {
  const controller = new AbortController();
  const relayAbort = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) relayAbort();
  else parentSignal?.addEventListener("abort", relayAbort, { once: true });
  let timer;
  // AbortSignal is advisory. Race the dependency so an ignored signal cannot
  // keep the next pub query waiting past its request budget.
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(
        `City enrichment request timed out after ${SEARCH_REQUEST_WALL_MS}ms.`,
      );
      controller.abort(error);
      reject(error);
    }, SEARCH_REQUEST_WALL_MS);
  });
  const operationPromise = Promise.resolve().then(() => operation(controller.signal));
  try {
    return await Promise.race([operationPromise, timeout]);
  } finally {
    clearTimeout(timer);
    void operationPromise.catch(() => {});
    parentSignal?.removeEventListener("abort", relayAbort);
  }
}

/**
 * The venues one run walks. Sequential from `startIndex` is the ordinary
 * coverage sweep; an explicit `indices` list is how the scheduler re-attempts
 * venues a previous run deferred, without disturbing the coverage cursor.
 */
function* venueIndexSequence(pubs, startIndex, indices) {
  if (Array.isArray(indices)) {
    for (const raw of indices) {
      const index = Math.floor(Number(raw));
      if (Number.isFinite(index) && index >= 0 && index < pubs.length) yield index;
    }
    return;
  }
  for (let index = Math.max(0, Math.floor(Number(startIndex) || 0)); index < pubs.length; index += 1) {
    yield index;
  }
}

export async function runCityEnrichment({
  city: cityId,
  pubs,
  apiKey,
  searchProvider,
  maxQueries = 200,
  // Can only lower the credit ceiling, never raise it.
  maxCredits = MAX_TAVILY_CREDITS_PER_RUN,
  startIndex = 0,
  indices,
  observedAt = new Date().toISOString(),
  fetchImpl = fetch,
  onProgress,
  // A venue whose search fails is a fact about that venue, not about the run.
  // The default stays "abort" so the CLI and every existing caller keep the
  // behaviour they were written against; the scheduler asks for "continue" so
  // one slow pub cannot throw away the rest of the night's budget.
  onVenueError,
  signal,
}) {
  const city = CITY_DEFINITIONS[cityId];
  if (!city) throw new Error(`Unsupported enrichment city "${cityId}".`);
  if (!searchProvider && !apiKey?.trim()) throw new Error("TAVILY_API_KEY is required.");
  if (!Array.isArray(pubs)) throw new Error("Expected pubs to be an array.");

  const queryCap = Math.min(
    MAX_TAVILY_CALLS_PER_RUN,
    Math.max(0, Math.floor(Number(maxQueries) || 0)),
  );
  const creditCap = Math.min(
    MAX_TAVILY_CREDITS_PER_RUN,
    Math.max(0, Math.floor(Number(maxCredits) || 0)),
  );
  const prices = [];
  const pages = [];
  const delegatedChains = [];
  const outcomes = [];
  const hostCounts = countPubsByHost(pubs);
  let queriesSpent = 0;
  let creditsSpent = 0;
  // The dearest search billed so far. Admission reserves this much, never less
  // than the documented price, so a provider that bills more per search than
  // TAVILY_CREDITS_PER_SEARCH cannot carry the run across the ceiling: the next
  // search is only admitted when one more like the dearest still fits.
  let dearestSearch = TAVILY_CREDITS_PER_SEARCH;
  const sequence = venueIndexSequence(pubs, startIndex, indices);
  let index = Math.max(0, Math.floor(Number(startIndex) || 0));
  let resolvedIndex = index;
  const report = async () => {
    if (!onProgress) return;
    await onProgress({
      nextIndex: resolvedIndex,
      queriesSpent,
      creditsSpent,
      prices,
      pages,
      delegatedChains,
      outcomes,
    });
  };

  for (const current of sequence) {
    index = current;
    throwIfAborted(signal);
    const pub = pubs[index];
    const unsearchable = unsearchableVenue(pub, index);
    if (unsearchable) {
      if (unsearchable.chain) delegatedChains.push({ pub, ...unsearchable.chain });
      outcomes.push(unsearchable.outcome);
      resolvedIndex = index + 1;
      await report();
      continue;
    }
    if (queriesSpent >= queryCap) break;
    // Ask before spending: the next search may bill as much as the dearest so far.
    if (creditsSpent + dearestSearch > creditCap) break;

    queriesSpent += 1;
    let payload;
    try {
      payload = await searchOfficialPage({
        pub,
        searchProvider,
        apiKey,
        fetchImpl,
        observedAt,
        signal,
      });
    } catch (error) {
      // An abort is the run's own deadline, never a verdict on this pub, so it
      // is never offered to the venue-level policy and leaves no outcome.
      if (error?.name === "AbortError") {
        await report();
        throw error;
      }
      // A query was spent asking about THIS pub and no answer came back. That
      // outcome is recorded whatever the caller then decides about the run, or
      // the venue that ends a run is a venue nobody ever hears about again.
      if (!runLevelFailure(error)) creditsSpent += dearestSearch;
      outcomes.push({
        index,
        osmId: pub.osmId,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      if ((onVenueError?.({ pub, index, error }) ?? "abort") !== "continue") {
        await report();
        throw error;
      }
      resolvedIndex = index + 1;
      await report();
      continue;
    }
    await report();
    throwIfAborted(signal);
    const searchCredits = Number(payload?.creditsSpent ?? payload?.usage?.credits) || 0;
    creditsSpent += searchCredits;
    dearestSearch = Math.max(dearestSearch, searchCredits);
    const officialResults = acceptedOfficialResults(pub, payload, hostCounts, observedAt);
    const matchedPage = await selectBestOfficialPage(officialResults, pub);

    outcomes.push({
      index,
      osmId: pub.osmId,
      status: matchedPage ? "matched" : "empty",
    });

    if (matchedPage) recordOfficialPage({ pub, matchedPage, observedAt, pages, prices });

    resolvedIndex = index + 1;
    await report();
  }

  return {
    city: cityId,
    totalPubs: pubs.length,
    startIndex,
    nextIndex: resolvedIndex,
    queriesSpent,
    creditsSpent,
    matchedPubs: pages.length,
    prices,
    pages,
    delegatedChains,
    outcomes,
    complete: !Array.isArray(indices) && resolvedIndex >= pubs.length,
  };
}
