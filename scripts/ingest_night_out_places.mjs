#!/usr/bin/env node

// Offline restaurant + attraction ingestion for the night-out planner.
//
// Exa and Firecrawl are discovery/transport providers, never fact authorities.
// The only publishable facts are deterministic JSON-LD fields read from the
// discovered source page. Generated summaries and free-form search snippets
// are ignored. Every row must pass lib/slopFilter.ts, London bounds, source URL,
// observation-date, and expiry checks in the shared night-out-place contract
// before it can enter the committed feed.
//
// Provider failures are fail-closed. Missing keys, authentication failures,
// credit/rate-limit responses, or upstream errors abort before the artifact is
// touched. The previous trusted snapshot remains byte-identical.

import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import {
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ipaddr from "ipaddr.js";

import {
  NIGHT_OUT_PLACE_MAX_AGE_MS,
  isCurrentNightOutPlace,
  isLondonNightOutPlaceCoordinates,
  isValidNightOutPlaceSnapshot,
  jobForNightOutPlaceCategory,
  nightOutPlaceProvenanceRegistryValidationErrors,
  presentableNightOutPlaceDescription,
} from "../lib/nightOutPlaceContract.mjs";
import {
  canonicalizeNightOutPlaceSourceUrl,
  nightOutPlaceSourceName,
} from "../lib/nightOutPlaceSourceUrl.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = join(ROOT, "public", "data", "night_out_places", "latest.json");
const PROVENANCE_REGISTRY = join(
  ROOT,
  "data",
  "night_out_place_provenance_registry.json",
);

const EXA_ENDPOINT = "https://api.exa.ai/search";
const FIRECRAWL_SEARCH_ENDPOINT = "https://api.firecrawl.dev/v2/search";
const FIRECRAWL_SCRAPE_ENDPOINT = "https://api.firecrawl.dev/v2/scrape";
const MAX_PROVIDER_TIMESTAMP_SKEW_MS = 5 * 60 * 1_000;
const DEFAULT_LIMIT_PER_QUERY = 5;
const FIRECRAWL_LIVE_OPTIONS = {
  formats: ["rawHtml"],
  onlyMainContent: false,
  maxAge: 0,
  storeInCache: false,
  lockdown: false,
  skipTlsVerification: false,
};

export const PLACE_QUERY_SET = [
  {
    category: "restaurant",
    query: "official London restaurant venue address",
  },
  {
    category: "attraction",
    query: "official London visitor attraction museum gallery address",
  },
];

const RESTAURANT_TYPES = new Set([
  "Restaurant",
  "FoodEstablishment",
  "CafeOrCoffeeShop",
]);
const ATTRACTION_TYPES = new Set([
  "TouristAttraction",
  "Museum",
  "ArtGallery",
  "LandmarksOrHistoricalBuildings",
  "Park",
]);

const isRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value, max = Infinity) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export const normalizeSourceUrl = canonicalizeNightOutPlaceSourceUrl;

export function sourceNameFromUrl(value) {
  return nightOutPlaceSourceName(value);
}

function stablePlaceId(category, sourceUrl) {
  const hash = createHash("sha256").update(`${category}|${sourceUrl}`).digest("hex").slice(0, 16);
  return `night-place-${category}-${hash}`;
}

function typeList(value) {
  const raw = value?.["@type"];
  if (typeof raw === "string") return [raw];
  if (Array.isArray(raw)) return raw.filter((item) => typeof item === "string");
  return [];
}

function typeMatches(value, category) {
  const allowed = category === "restaurant" ? RESTAURANT_TYPES : ATTRACTION_TYPES;
  return typeList(value).some((type) => allowed.has(type));
}

function flattenJsonLd(value) {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!isRecord(value)) return [];
  const graph = Array.isArray(value["@graph"])
    ? value["@graph"].flatMap(flattenJsonLd)
    : [];
  return [value, ...graph];
}

export function parseJsonLdBlocks(rawHtml) {
  if (!text(rawHtml)) return [];
  const blocks = [];
  const pattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of rawHtml.matchAll(pattern)) {
    try {
      blocks.push(...flattenJsonLd(JSON.parse(match[1].trim())));
    } catch {
      // A malformed block is not evidence. Keep scanning the page for another.
    }
  }
  return blocks;
}

function addressFromJsonLd(value) {
  const address = value?.address;
  if (typeof address === "string") {
    return { address: address.trim(), area: "London" };
  }
  if (!isRecord(address)) return null;
  const parts = [
    address.streetAddress,
    address.addressLocality,
    address.postalCode,
  ]
    .filter((part) => text(part))
    .map((part) => part.trim());
  if (parts.length < 2) return null;
  const area = text(address.addressLocality, 120)
    ? address.addressLocality.trim()
    : "London";
  return { address: parts.join(", "), area };
}

function locationFromJsonLd(value) {
  const geo = value?.geo;
  if (!isRecord(geo)) return null;
  const lat = finiteNumber(geo.latitude);
  const lng = finiteNumber(geo.longitude);
  if (lat === null || lng === null) return null;
  if (!isLondonNightOutPlaceCoordinates(lat, lng)) return null;
  return { lat, lng };
}

/**
 * Convert one source page into a publishable row. No generated provider text
 * participates: all fields below come from a matching JSON-LD object.
 */
export function sourcePageToPlace(
  page,
  { category, discoveredVia, observedAt },
) {
  const job = jobForNightOutPlaceCategory(category);
  if (!job) return null;
  const sourceUrl = normalizeSourceUrl(page?.url);
  const sourceName = sourceUrl ? sourceNameFromUrl(sourceUrl) : null;
  if (!sourceUrl || !sourceName) return null;
  const observedMs = Date.parse(observedAt);
  if (!Number.isFinite(observedMs)) return null;

  const categoryCandidates = parseJsonLdBlocks(page?.rawHtml).filter((value) =>
    typeMatches(value, category),
  );
  // Directory/list pages are ambiguous even when one entry happens to declare
  // the discovered URL. Publish only a single place entity whose canonical
  // JSON-LD URL exactly identifies this page, including its path.
  if (categoryCandidates.length !== 1) return null;
  const candidates = categoryCandidates.filter(
    (value) => normalizeSourceUrl(value?.url) === sourceUrl,
  );
  for (const value of candidates) {
    const name = text(value.name, 160) ? value.name.trim() : null;
    const description = presentableNightOutPlaceDescription(
      text(value.description, 600) ? value.description : null,
    );
    const address = addressFromJsonLd(value);
    const location = locationFromJsonLd(value);
    if (!name || !description || !address || !location) continue;

    return {
      id: stablePlaceId(category, sourceUrl),
      category,
      job,
      name,
      description,
      address: address.address,
      area: address.area,
      location,
      sourceUrl,
      sourceName,
      observedAt: new Date(observedMs).toISOString(),
      expiresAt: new Date(observedMs + NIGHT_OUT_PLACE_MAX_AGE_MS).toISOString(),
      discoveredVia,
      extractedVia: "firecrawl",
    };
  }
  return null;
}

export function buildPlaceRows(discoveries, { observedAt }) {
  const byId = new Map();
  for (const discovery of Array.isArray(discoveries) ? discoveries : []) {
    if (!PLACE_QUERY_SET.some((query) => query.category === discovery?.category)) continue;
    if (!(["exa", "firecrawl"]).includes(discovery?.discoveredVia)) continue;
    const place = sourcePageToPlace(discovery, {
      category: discovery.category,
      discoveredVia: discovery.discoveredVia,
      observedAt: validIso(discovery.observedAt) ? discovery.observedAt : observedAt,
    });
    if (place && !byId.has(place.id)) byId.set(place.id, place);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export class ProviderHaltError extends Error {
  constructor(provider, reason, status = null) {
    const statusText = status === null ? "" : ` (HTTP ${status})`;
    super(`OWNER ACTION: ${provider} ${reason}${statusText}. Artifact not written.`);
    this.name = "ProviderHaltError";
    this.provider = provider;
    this.reason = reason;
    this.status = status;
  }
}

export function classifyProviderFailure(provider, status) {
  if (status === 401 || status === 403) {
    return new ProviderHaltError(provider, "authentication failed", status);
  }
  if (status === 402) {
    return new ProviderHaltError(provider, "credits are exhausted", status);
  }
  if (status === 429) {
    return new ProviderHaltError(provider, "credit or rate limit reached", status);
  }
  return new ProviderHaltError(provider, "request failed", status);
}

export function isPublicIpAddress(address) {
  if (typeof address !== "string") return false;
  try {
    // ipaddr.js maintains the IANA-style IPv4/IPv6 range taxonomy. Processing
    // first converts IPv4-mapped IPv6 so it cannot bypass the IPv4 decision.
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}

/**
 * Advisory local preflight only. Firecrawl resolves the target independently,
 * so this cannot pin its DNS answer or guarantee against rebinding. The actual
 * provider boundary is a live Firecrawl fetch plus returned-final-URL checks.
 */
export async function assertAdvisoryPublicResolution(value, lookupImpl = dnsLookup) {
  const canonical = normalizeSourceUrl(value);
  if (!canonical) throw new ProviderHaltError("Source URL", "failed the public URL contract");
  const hostname = new URL(canonical).hostname;
  let answers;
  try {
    answers = await lookupImpl(hostname, { all: true, verbatim: true });
  } catch {
    throw new ProviderHaltError("Source URL", "DNS resolution failed");
  }
  if (
    !Array.isArray(answers) ||
    answers.length === 0 ||
    answers.some(
      (answer) =>
        !isRecord(answer) ||
        typeof answer.address !== "string" ||
        !isPublicIpAddress(answer.address),
    )
  ) {
    throw new ProviderHaltError("Source URL", "resolved to a non-public address");
  }
  return canonical;
}

async function requestJson(
  provider,
  url,
  init,
  fetchImpl = fetch,
  nowImpl = () => new Date(),
) {
  let response;
  try {
    response = await fetchImpl(url, init);
  } catch {
    throw new ProviderHaltError(provider, "network request failed");
  }
  if (!response.ok) throw classifyProviderFailure(provider, response.status);
  try {
    const payload = await response.json();
    if (!isRecord(payload)) {
      throw new ProviderHaltError(provider, "returned a malformed response");
    }
    const receivedAt = nowImpl().toISOString();
    if (!validIso(receivedAt)) {
      throw new ProviderHaltError(provider, "could not establish response receipt time");
    }
    return { payload, receivedAt };
  } catch (error) {
    if (error instanceof ProviderHaltError) throw error;
    throw new ProviderHaltError(provider, "returned an invalid response");
  }
}

function firecrawlResponseIsCached(data) {
  const metadata = data.metadata;
  if (!isRecord(metadata)) return true;
  if (
    metadata.cached === true ||
    metadata.fromCache === true ||
    metadata.cacheHit === true ||
    (typeof metadata.cacheStatus === "string" && metadata.cacheStatus.toLowerCase() !== "miss") ||
    (typeof metadata.cacheAge === "number" && metadata.cacheAge > 0) ||
    metadata.cachedAt !== undefined
  ) {
    return true;
  }
  return typeof data.warning === "string" && /\bcach(?:e|ed)\b/i.test(data.warning);
}

function validateProviderTimestamp(metadata, receivedAt) {
  for (const key of ["fetchedAt", "scrapedAt"]) {
    if (metadata[key] === undefined) continue;
    const timestamp = Date.parse(metadata[key]);
    const received = Date.parse(receivedAt);
    if (
      !Number.isFinite(timestamp) ||
      timestamp > received + MAX_PROVIDER_TIMESTAMP_SKEW_MS ||
      received - timestamp > MAX_PROVIDER_TIMESTAMP_SKEW_MS
    ) {
      return false;
    }
  }
  return true;
}

function liveFirecrawlPage(data, requestedUrl, receivedAt) {
  if (!isRecord(data) || !text(data.rawHtml) || !isRecord(data.metadata)) return null;
  const requested = normalizeSourceUrl(requestedUrl);
  const identityValues = [data.metadata.sourceURL, data.metadata.url];
  for (const optionalKey of ["finalURL", "finalUrl", "canonicalURL", "canonicalUrl"]) {
    if (data.metadata[optionalKey] !== undefined) identityValues.push(data.metadata[optionalKey]);
  }
  const identities = identityValues.map(normalizeSourceUrl);
  if (
    !requested ||
    identities.some((identity) => identity === null || identity !== requested) ||
    !Number.isInteger(data.metadata.statusCode) ||
    data.metadata.statusCode < 200 ||
    data.metadata.statusCode >= 300 ||
    firecrawlResponseIsCached(data) ||
    !validateProviderTimestamp(data.metadata, receivedAt)
  ) {
    return null;
  }
  return { url: requested, rawHtml: data.rawHtml, observedAt: receivedAt };
}

async function exaDiscover(apiKey, limit, fetchImpl, nowImpl) {
  const discoveries = [];
  for (const query of PLACE_QUERY_SET) {
    const { payload } = await requestJson(
      "Exa",
      EXA_ENDPOINT,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({
          query: query.query,
          type: "auto",
          numResults: limit,
          userLocation: "GB",
          moderation: true,
        }),
      },
      fetchImpl,
      nowImpl,
    );
    if (!Array.isArray(payload.results)) {
      throw new ProviderHaltError("Exa", "returned a malformed search response");
    }
    for (const result of payload.results) {
      const url = isRecord(result) ? normalizeSourceUrl(result.url) : null;
      if (!url) throw new ProviderHaltError("Exa", "returned an invalid result URL");
      discoveries.push({ category: query.category, discoveredVia: "exa", url });
    }
  }
  return discoveries;
}

async function firecrawlDiscover(apiKey, limit, fetchImpl, lookupImpl, nowImpl) {
  const discoveries = [];
  for (const query of PLACE_QUERY_SET) {
    const { payload, receivedAt } = await requestJson(
      "Firecrawl",
      FIRECRAWL_SEARCH_ENDPOINT,
      {
        method: "POST",
        cache: "no-store",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "cache-control": "no-cache",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: query.query,
          limit,
          sources: ["web"],
          location: "London, England, United Kingdom",
          country: "GB",
          ignoreInvalidURLs: true,
          scrapeOptions: FIRECRAWL_LIVE_OPTIONS,
        }),
      },
      fetchImpl,
      nowImpl,
    );
    if (payload.success !== true || !isRecord(payload.data) || !Array.isArray(payload.data.web)) {
      throw new ProviderHaltError("Firecrawl", "returned a malformed search response");
    }
    if (typeof payload.warning === "string" && /\bcach(?:e|ed)\b/i.test(payload.warning)) {
      throw new ProviderHaltError("Firecrawl", "search response disclosed cached content");
    }
    for (const result of payload.data.web) {
      const requestedUrl = isRecord(result) ? normalizeSourceUrl(result.url) : null;
      const page = requestedUrl
        ? liveFirecrawlPage(result, requestedUrl, receivedAt)
        : null;
      if (!page) {
        throw new ProviderHaltError(
          "Firecrawl",
          "returned stale, cached, redirected, or incomplete search content",
        );
      }
      await assertAdvisoryPublicResolution(page.url, lookupImpl);
      discoveries.push({
        category: query.category,
        discoveredVia: "firecrawl",
        ...page,
      });
    }
  }
  return discoveries;
}

async function firecrawlScrape(apiKey, url, fetchImpl, lookupImpl, nowImpl) {
  await assertAdvisoryPublicResolution(url, lookupImpl);
  const { payload, receivedAt } = await requestJson(
    "Firecrawl",
    FIRECRAWL_SCRAPE_ENDPOINT,
    {
      method: "POST",
      cache: "no-store",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "cache-control": "no-cache",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        url,
        ...FIRECRAWL_LIVE_OPTIONS,
        removeBase64Images: true,
        blockAds: true,
        location: { country: "GB", languages: ["en-GB"] },
      }),
    },
    fetchImpl,
    nowImpl,
  );
  const page = payload.success === true &&
    !(typeof payload.warning === "string" && /\bcach(?:e|ed)\b/i.test(payload.warning))
    ? liveFirecrawlPage(payload.data, url, receivedAt)
    : null;
  if (!page) {
    throw new ProviderHaltError(
      "Firecrawl",
      "returned stale, cached, redirected, or incomplete scrape content",
    );
  }
  return page;
}

export async function fetchDiscoveries(
  { exaKey, firecrawlKey, limit = DEFAULT_LIMIT_PER_QUERY },
  fetchImpl = fetch,
  lookupImpl = dnsLookup,
  nowImpl = () => new Date(),
) {
  if (!text(exaKey)) throw new ProviderHaltError("Exa", "API key is missing");
  if (!text(firecrawlKey)) {
    throw new ProviderHaltError("Firecrawl", "API key is missing");
  }
  const [exa, firecrawl] = await Promise.all([
    exaDiscover(exaKey, limit, fetchImpl, nowImpl),
    firecrawlDiscover(firecrawlKey, limit, fetchImpl, lookupImpl, nowImpl),
  ]);
  // Search providers frequently find the same official page. Consolidate it
  // before scraping so one source URL costs at most one Firecrawl page fetch.
  // Prefer an already-returned rawHtml body over issuing a duplicate scrape.
  const bySource = new Map();
  for (const discovery of [...exa, ...firecrawl]) {
    const key = `${discovery.category}|${discovery.url}`;
    const current = bySource.get(key);
    if (!current || (!text(current.rawHtml) && text(discovery.rawHtml))) {
      bySource.set(key, {
        ...discovery,
        discoveredVia: current?.discoveredVia ?? discovery.discoveredVia,
      });
    }
  }
  const discoveries = [...bySource.values()];
  for (const discovery of discoveries) {
    if (!text(discovery.rawHtml)) {
      const page = await firecrawlScrape(
        firecrawlKey,
        discovery.url,
        fetchImpl,
        lookupImpl,
        nowImpl,
      );
      Object.assign(discovery, page);
    }
  }
  return discoveries;
}

function validIso(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function isValidPlaceSnapshot(snapshot) {
  return isValidNightOutPlaceSnapshot(snapshot);
}

function assertValidProvenanceRegistry(snapshot, registryPath = PROVENANCE_REGISTRY) {
  let registry;
  try {
    registry = JSON.parse(readFileSync(registryPath, "utf8"));
  } catch {
    throw new ProviderHaltError("Provenance registry", "is required but invalid");
  }
  if (nightOutPlaceProvenanceRegistryValidationErrors(registry, snapshot).length > 0) {
    throw new ProviderHaltError("Provenance registry", "does not match the candidate artifact");
  }
}

export function loadCurrentPlaces(nowMs, outputPath = OUTPUT) {
  if (!existsSync(outputPath)) {
    throw new ProviderHaltError("Current artifact", "is required but missing");
  }
  try {
    const snapshot = JSON.parse(readFileSync(outputPath, "utf8"));
    if (!isValidPlaceSnapshot(snapshot)) {
      throw new ProviderHaltError("Current artifact", "failed validation");
    }
    return snapshot.places.filter((place) =>
      isCurrentNightOutPlace(place, nowMs),
    );
  } catch (error) {
    if (error instanceof ProviderHaltError) throw error;
    throw new ProviderHaltError("Current artifact", "could not be parsed");
  }
}

export function mergePlaceRows(existing, incoming) {
  const byId = new Map();
  for (const row of [...existing, ...incoming]) {
    if (text(row?.id)) byId.set(row.id, row);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function writeSnapshot(snapshot, outputPath = OUTPUT) {
  if (!isValidPlaceSnapshot(snapshot)) {
    throw new ProviderHaltError("Candidate artifact", "failed validation");
  }
  assertValidProvenanceRegistry(snapshot);
  const temp = `${outputPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temp, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: "wx" });
    renameSync(temp, outputPath);
  } catch (error) {
    if (existsSync(temp)) unlinkSync(temp);
    throw error;
  }
}

function parseArgs(argv) {
  let dryRun = false;
  let limit = DEFAULT_LIMIT_PER_QUERY;
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--dry-run") dryRun = true;
    if (argv[i] === "--limit" && argv[i + 1]) {
      limit = Math.min(10, Math.max(1, Number.parseInt(argv[++i], 10) || limit));
    }
  }
  return { dryRun, limit };
}

export async function runIngestion({
  dryRun = false,
  limit = DEFAULT_LIMIT_PER_QUERY,
  observedAt,
  outputPath = OUTPUT,
  exaKey = process.env.EXA_API_KEY?.trim(),
  firecrawlKey = process.env.FIRECRAWL_API_KEY?.trim(),
  fetchImpl = fetch,
  lookupImpl = dnsLookup,
  nowImpl,
} = {}) {
  const clock = nowImpl ?? (observedAt
    ? () => new Date(observedAt)
    : () => new Date());
  const startedAt = observedAt ?? clock().toISOString();
  if (!validIso(startedAt)) {
    throw new ProviderHaltError("Ingestion clock", "returned an invalid timestamp");
  }
  const existing = loadCurrentPlaces(Date.parse(startedAt), outputPath);
  assertValidProvenanceRegistry({ provenanceRegistryVersion: 1 });
  const discoveries = await fetchDiscoveries(
    { exaKey, firecrawlKey, limit },
    fetchImpl,
    lookupImpl,
    clock,
  );
  const generatedAt = observedAt ?? clock().toISOString();
  const incoming = buildPlaceRows(discoveries, { observedAt: generatedAt });
  const places = mergePlaceRows(existing, incoming);
  const snapshot = {
    version: 1,
    generatedAt,
    status: places.length > 0 ? "published" : "empty",
    provenanceRegistryVersion: 1,
    places,
  };
  if (!isValidPlaceSnapshot(snapshot)) {
    throw new ProviderHaltError("Candidate artifact", "failed post-merge validation");
  }
  if (!dryRun) writeSnapshot(snapshot, outputPath);
  console.log(
    `${dryRun ? "Dry run:" : "Wrote"} ${incoming.length} new, ${places.length} current sourced place(s).`,
  );
  return snapshot;
}

async function main() {
  const { dryRun, limit } = parseArgs(process.argv);
  await runIngestion({ dryRun, limit });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
