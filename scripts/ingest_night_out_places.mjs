#!/usr/bin/env node

// Offline restaurant + attraction ingestion for the night-out planner.
//
// Exa and Firecrawl are discovery/transport providers, never fact authorities.
// The only publishable facts are deterministic JSON-LD fields read from the
// discovered source page. Generated summaries and free-form search snippets
// are ignored. Every row must pass lib/slopFilter.ts, London bounds, source URL,
// observation-date, and expiry checks before it can enter the committed feed.
//
// Provider failures are fail-closed. Missing keys, authentication failures,
// credit/rate-limit responses, or upstream errors abort before the artifact is
// touched. The previous trusted snapshot remains byte-identical.

import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { presentableDescription } from "../lib/slopFilter.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = join(ROOT, "public", "data", "night_out_places", "latest.json");

const EXA_ENDPOINT = "https://api.exa.ai/search";
const FIRECRAWL_SEARCH_ENDPOINT = "https://api.firecrawl.dev/v2/search";
const FIRECRAWL_SCRAPE_ENDPOINT = "https://api.firecrawl.dev/v2/scrape";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const DEFAULT_LIMIT_PER_QUERY = 5;

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

export function normalizeSourceUrl(value) {
  if (!text(value, 2_000)) return null;
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.hostname === "localhost" ||
      url.hostname.endsWith(".local") ||
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname)
    ) {
      return null;
    }
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.origin}${pathname}`;
  } catch {
    return null;
  }
}

export function sourceNameFromUrl(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
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
  if (lat < 51.26 || lat > 51.72 || lng < -0.55 || lng > 0.3) return null;
  return { lat, lng };
}

function sourceUrlMatchesJsonLd(sourceUrl, value) {
  const declared = normalizeSourceUrl(value?.url);
  if (!declared) return true;
  return new URL(declared).hostname === new URL(sourceUrl).hostname;
}

/**
 * Convert one source page into a publishable row. No generated provider text
 * participates: all fields below come from a matching JSON-LD object.
 */
export function sourcePageToPlace(
  page,
  { category, discoveredVia, observedAt },
) {
  const sourceUrl = normalizeSourceUrl(page?.url);
  const sourceName = sourceUrl ? sourceNameFromUrl(sourceUrl) : null;
  if (!sourceUrl || !sourceName) return null;
  const observedMs = Date.parse(observedAt);
  if (!Number.isFinite(observedMs)) return null;

  const candidates = parseJsonLdBlocks(page?.rawHtml).filter(
    (value) => typeMatches(value, category) && sourceUrlMatchesJsonLd(sourceUrl, value),
  );
  for (const value of candidates) {
    const name = text(value.name, 160) ? value.name.trim() : null;
    const description = presentableDescription(
      text(value.description, 600) ? value.description : null,
    );
    const address = addressFromJsonLd(value);
    const location = locationFromJsonLd(value);
    if (!name || !description || !address || !location) continue;

    return {
      id: stablePlaceId(category, sourceUrl),
      category,
      job: category === "restaurant" ? "near_pub_food" : "pre_pub_attraction",
      name,
      description,
      address: address.address,
      area: address.area,
      location,
      sourceUrl,
      sourceName,
      observedAt: new Date(observedMs).toISOString(),
      expiresAt: new Date(observedMs + MAX_AGE_MS).toISOString(),
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
      observedAt,
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

async function requestJson(provider, url, init, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(url, init);
  } catch {
    throw new ProviderHaltError(provider, "network request failed");
  }
  if (!response.ok) throw classifyProviderFailure(provider, response.status);
  try {
    return await response.json();
  } catch {
    throw new ProviderHaltError(provider, "returned an invalid response");
  }
}

async function exaDiscover(apiKey, limit, fetchImpl = fetch) {
  const discoveries = [];
  for (const query of PLACE_QUERY_SET) {
    const payload = await requestJson(
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
    );
    for (const result of Array.isArray(payload?.results) ? payload.results : []) {
      const url = normalizeSourceUrl(result?.url);
      if (url) discoveries.push({ category: query.category, discoveredVia: "exa", url });
    }
  }
  return discoveries;
}

async function firecrawlDiscover(apiKey, limit, fetchImpl = fetch) {
  const discoveries = [];
  for (const query of PLACE_QUERY_SET) {
    const payload = await requestJson(
      "Firecrawl",
      FIRECRAWL_SEARCH_ENDPOINT,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: query.query,
          limit,
          sources: ["web"],
          location: "London, England, United Kingdom",
          country: "GB",
          ignoreInvalidURLs: true,
          scrapeOptions: {
            formats: ["rawHtml"],
            onlyMainContent: false,
          },
        }),
      },
      fetchImpl,
    );
    if (payload?.success !== true) {
      throw new ProviderHaltError("Firecrawl", "search did not complete");
    }
    for (const result of Array.isArray(payload?.data?.web) ? payload.data.web : []) {
      const url = normalizeSourceUrl(result?.url ?? result?.metadata?.sourceURL);
      if (!url) continue;
      discoveries.push({
        category: query.category,
        discoveredVia: "firecrawl",
        url,
        rawHtml: text(result?.rawHtml) ? result.rawHtml : null,
      });
    }
  }
  return discoveries;
}

async function firecrawlScrape(apiKey, url, fetchImpl = fetch) {
  const payload = await requestJson(
    "Firecrawl",
    FIRECRAWL_SCRAPE_ENDPOINT,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["rawHtml"],
        onlyMainContent: false,
        removeBase64Images: true,
        blockAds: true,
        location: { country: "GB", languages: ["en-GB"] },
      }),
    },
    fetchImpl,
  );
  if (payload?.success !== true) {
    throw new ProviderHaltError("Firecrawl", "scrape did not complete");
  }
  return text(payload?.data?.rawHtml) ? payload.data.rawHtml : "";
}

export async function fetchDiscoveries(
  { exaKey, firecrawlKey, limit = DEFAULT_LIMIT_PER_QUERY },
  fetchImpl = fetch,
) {
  if (!text(exaKey)) throw new ProviderHaltError("Exa", "API key is missing");
  if (!text(firecrawlKey)) {
    throw new ProviderHaltError("Firecrawl", "API key is missing");
  }
  const [exa, firecrawl] = await Promise.all([
    exaDiscover(exaKey, limit, fetchImpl),
    firecrawlDiscover(firecrawlKey, limit, fetchImpl),
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
      discovery.rawHtml = await firecrawlScrape(firecrawlKey, discovery.url, fetchImpl);
    }
  }
  return discoveries;
}

function loadCurrentPlaces(nowMs) {
  if (!existsSync(OUTPUT)) return [];
  try {
    const snapshot = JSON.parse(readFileSync(OUTPUT, "utf8"));
    return (Array.isArray(snapshot?.places) ? snapshot.places : []).filter((place) => {
      const observed = Date.parse(place?.observedAt);
      const expires = Date.parse(place?.expiresAt);
      return Number.isFinite(observed) && observed <= nowMs && expires > nowMs;
    });
  } catch {
    return [];
  }
}

export function mergePlaceRows(existing, incoming) {
  const byId = new Map();
  for (const row of [...existing, ...incoming]) {
    if (text(row?.id)) byId.set(row.id, row);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function writeSnapshot(snapshot) {
  const temp = `${OUTPUT}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: "wx" });
  renameSync(temp, OUTPUT);
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

async function main() {
  const { dryRun, limit } = parseArgs(process.argv);
  const observedAt = new Date().toISOString();
  const discoveries = await fetchDiscoveries({
    exaKey: process.env.EXA_API_KEY?.trim(),
    firecrawlKey: process.env.FIRECRAWL_API_KEY?.trim(),
    limit,
  });
  const incoming = buildPlaceRows(discoveries, { observedAt });
  const places = mergePlaceRows(loadCurrentPlaces(Date.parse(observedAt)), incoming);
  const snapshot = {
    version: 1,
    generatedAt: observedAt,
    status: places.length > 0 ? "published" : "empty",
    provenanceRegistryVersion: 1,
    places,
  };
  if (!dryRun) writeSnapshot(snapshot);
  console.log(
    `${dryRun ? "Dry run:" : "Wrote"} ${incoming.length} new, ${places.length} current sourced place(s).`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
