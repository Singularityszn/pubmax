// Server-only MCP client for CityMCP London (https://citymcp.com/london/mcp).
//
// The upstream is a Streamable-HTTP MCP endpoint that answers `tools/call`
// requests as `text/event-stream` responses containing a single JSON-RPC
// message. We do NOT run a persistent client here — every call is a fresh
// POST with `Accept: application/json, text/event-stream`, matching the
// server's probe expectations (see `/tmp/citymcp-london-tools.json`).
//
// Design notes
// ------------
//  - Fail-soft: any transport, timeout, or JSON-RPC error surfaces as a typed
//    `CityMcpError` from `callCityMcpTool`, so API routes can degrade cleanly
//    without ever returning a hard 500 to the client.
//  - AbortController timeout (~10s by default; callers can override) keeps
//    the app snappy when the upstream is slow.
//  - `city_status` is cached in-process for CITY_STATUS_TTL_MS (~5min) to
//    protect the upstream from repeated pageloads and keep the map banner
//    render close to instant. The cache is module-scoped; per-instance in
//    serverless, which is fine because the TTL is short.
//  - No secrets: the endpoint is keyless. If we ever need auth headers, wire
//    them here.
//  - Test seams: exports `resetCityStatusCache()` and lets callers inject a
//    custom `fetchImpl` via options — the route tests do exactly this.

const DEFAULT_ENDPOINT = "https://citymcp.com/london/mcp";
const DEFAULT_TIMEOUT_MS = 10_000;
const CITY_STATUS_TTL_MS = 5 * 60 * 1000;
const PLACE_TTL_MS = 10 * 60 * 1000;
const THINGS_TO_DO_TTL_MS = 5 * 60 * 1000;
const PROTOCOL_VERSION = "2025-06-18";
const CLIENT_INFO = { name: "pubmaxing-citymcp-client", version: "0.1.0" };

// ---------- Public types ----------

export type CityMcpToolName =
  | "search_places"
  | "get_place"
  | "get_area"
  | "get_journey"
  | "city_status"
  | "things_to_do";

export type CityMcpCallOptions = {
  /** Abort after this many ms (default 10s). */
  timeoutMs?: number;
  /** Override endpoint (test injection; default is the live URL). */
  endpoint?: string;
  /** Override the fetch implementation (test injection). */
  fetchImpl?: typeof fetch;
  /** Override AbortSignal (advanced; usually leave alone). */
  signal?: AbortSignal;
};

export class CityMcpError extends Error {
  readonly kind:
    | "network"
    | "timeout"
    | "http"
    | "parse"
    | "rpc"
    | "empty";
  readonly httpStatus?: number;
  readonly rpcCode?: number;
  constructor(
    message: string,
    kind: CityMcpError["kind"],
    extras?: { httpStatus?: number; rpcCode?: number },
  ) {
    super(message);
    this.name = "CityMcpError";
    this.kind = kind;
    this.httpStatus = extras?.httpStatus;
    this.rpcCode = extras?.rpcCode;
  }
}

// ---------- Structured content types (per probe notes) ----------

export type CityStatusSeverity = "info" | "notable" | "major";

export type CityStatusSignal = {
  headline: string;
  detail?: string;
  kind?: string;
  severity?: CityStatusSeverity | string;
  areas?: string[];
  postcodes?: string[];
  timeWindow?: string;
  sourceUrl?: string;
  fetchedAt?: string;
};

export type CityStatusWeather = {
  condition?: string;
  tempC?: number;
  feelsLikeC?: number;
  todayHighC?: number;
  todayLowC?: number;
  windMph?: number;
  precipProbabilityPct?: number;
  isDay?: boolean;
};

export type CityStatusTubeLine = {
  line: string;
  status: string;
  disruption?: string;
};

export type CityStatus = {
  asOf: string;
  weather?: CityStatusWeather;
  tubeLines?: CityStatusTubeLine[];
  signals: CityStatusSignal[];
};

export type SearchPlacesRow = {
  id: string;
  name: string;
  area?: string;
  location?: { lat: number; lng: number };
  types?: string[];
  rating?: number;
  userRatingCount?: number;
  priceBand?: string;
  openNow?: boolean;
};

// ---------- SSE / JSON-RPC parsing ----------

/**
 * Parse a Streamable-HTTP MCP response body. The upstream returns SSE frames
 * of the shape:
 *
 *   event: message
 *   data: {"jsonrpc":"2.0","id":1,"result":{...}}
 *
 * A `tools/call` response is always a single `event: message` frame carrying
 * one JSON-RPC envelope. We return the parsed envelope, or throw a typed
 * `CityMcpError` on shape/JSON failures. Exported for unit testing.
 */
export function parseSseJsonRpcBody(body: string): {
  jsonrpc?: string;
  id?: number | string;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
} {
  // Some servers might reply with a plain JSON body if the client sent the
  // Accept header wrong; accept that too as a fallback.
  const trimmed = body.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch (err) {
      throw new CityMcpError(
        `Invalid JSON body: ${(err as Error).message}`,
        "parse",
      );
    }
  }

  const frames = trimmed.split(/\r?\n\r?\n/);
  for (const frame of frames) {
    // Collect `data:` continuation lines within one event.
    const dataLines: string[] = [];
    let eventName = "message";
    for (const rawLine of frame.split(/\r?\n/)) {
      const line = rawLine.trimEnd();
      if (!line || line.startsWith(":")) continue; // comment / heartbeat
      const idx = line.indexOf(":");
      const field = idx === -1 ? line : line.slice(0, idx);
      const value =
        idx === -1 ? "" : line.slice(idx + 1).replace(/^\s/, "");
      if (field === "event") eventName = value;
      else if (field === "data") dataLines.push(value);
      // ignore id / retry — MCP tools/call never uses them for payload
    }
    if (eventName !== "message" || dataLines.length === 0) continue;
    const dataStr = dataLines.join("\n");
    try {
      return JSON.parse(dataStr) as {
        jsonrpc?: string;
        id?: number | string;
        result?: unknown;
        error?: { code?: number; message?: string; data?: unknown };
      };
    } catch (err) {
      throw new CityMcpError(
        `Invalid JSON-RPC frame: ${(err as Error).message}`,
        "parse",
      );
    }
  }
  throw new CityMcpError("No SSE `message` frame found", "empty");
}

// ---------- Core POST helper ----------

async function postJsonRpc(
  endpoint: string,
  payload: unknown,
  opts: CityMcpCallOptions,
): Promise<Response> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  // Combine caller signal + our timeout signal.
  const abortHandler = () => controller.abort();
  if (opts.signal) opts.signal.addEventListener("abort", abortHandler);
  try {
    return await fetchImpl(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        // The upstream requires BOTH JSON and event-stream to be advertised.
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": PROTOCOL_VERSION,
        "user-agent": "PubMaxxing-CityMCP/0.1 (+https://pubmaxxing.com)",
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // AbortError → timeout; anything else → generic network failure.
    const asErr = err as Error & { name?: string };
    if (asErr?.name === "AbortError") {
      throw new CityMcpError("CityMCP request timed out", "timeout");
    }
    throw new CityMcpError(
      `CityMCP network error: ${asErr?.message ?? String(err)}`,
      "network",
    );
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener("abort", abortHandler);
  }
}

// ---------- Public helpers ----------

let jsonRpcCounter = 1;
function nextJsonRpcId(): number {
  const id = jsonRpcCounter;
  jsonRpcCounter = jsonRpcCounter >= Number.MAX_SAFE_INTEGER ? 1 : id + 1;
  return id;
}

/**
 * Call a CityMCP London tool by name. Returns the parsed `result` object from
 * the JSON-RPC envelope (which contains at least `structuredContent`). Throws
 * `CityMcpError` on any failure — callers should try/catch and degrade.
 */
export async function callCityMcpTool<T = unknown>(
  name: CityMcpToolName,
  args: Record<string, unknown> = {},
  opts: CityMcpCallOptions = {},
): Promise<{ structuredContent?: T; content?: unknown; isError?: boolean }> {
  const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
  const payload = {
    jsonrpc: "2.0",
    id: nextJsonRpcId(),
    method: "tools/call",
    params: {
      name,
      arguments: args,
      _meta: { clientInfo: CLIENT_INFO },
    },
  };

  const res = await postJsonRpc(endpoint, payload, opts);
  if (!res.ok) {
    throw new CityMcpError(
      `CityMCP HTTP ${res.status}`,
      "http",
      { httpStatus: res.status },
    );
  }
  const text = await res.text();
  const envelope = parseSseJsonRpcBody(text);
  if (envelope.error) {
    throw new CityMcpError(
      envelope.error.message ?? "CityMCP RPC error",
      "rpc",
      { rpcCode: envelope.error.code },
    );
  }
  const result = envelope.result as
    | { structuredContent?: T; content?: unknown; isError?: boolean }
    | undefined;
  if (!result) {
    throw new CityMcpError("CityMCP RPC missing result", "empty");
  }
  if (result.isError) {
    throw new CityMcpError("CityMCP tool reported an error", "rpc");
  }
  return result;
}

// ---------- city_status: cached convenience ----------

type CityStatusCacheEntry = { value: CityStatus; expiresAt: number };
const cityStatusCache = new Map<string, CityStatusCacheEntry>();

/** Test-only: drop all cached city_status entries. */
export function resetCityStatusCache(): void {
  cityStatusCache.clear();
}

/**
 * Fetch `city_status` with an in-memory TTL of ~5 minutes. `borough` is
 * optional — the upstream filters signals when it's provided. Throws
 * `CityMcpError` on failure; callers fail-soft.
 */
export async function fetchCityStatus(
  args: { borough?: string } = {},
  opts: CityMcpCallOptions = {},
): Promise<CityStatus> {
  const cacheKey = args.borough ? `b:${args.borough}` : "_";
  const now = Date.now();
  const cached = cityStatusCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;

  const result = await callCityMcpTool<CityStatus>("city_status", args, opts);
  const structured = result.structuredContent;
  if (!structured || typeof structured !== "object") {
    throw new CityMcpError("city_status: missing structuredContent", "empty");
  }
  const normalised: CityStatus = {
    asOf: typeof structured.asOf === "string" ? structured.asOf : new Date().toISOString(),
    weather: structured.weather,
    tubeLines: Array.isArray(structured.tubeLines) ? structured.tubeLines : undefined,
    signals: Array.isArray(structured.signals) ? structured.signals : [],
  };
  cityStatusCache.set(cacheKey, {
    value: normalised,
    expiresAt: now + CITY_STATUS_TTL_MS,
  });
  return normalised;
}

// ---------- search_places convenience ----------

export type SearchCityPlacesOpts = {
  limit?: number;
  near?: string;
  openNow?: boolean;
  minRating?: number;
  maxPrice?: "free" | "£" | "££" | "£££" | "££££";
  sort?: "relevance" | "rating" | "random";
  timeoutMs?: number;
  endpoint?: string;
  fetchImpl?: typeof fetch;
};

/**
 * Search London venues by natural-language query and return thin rows for
 * scanning. Throws `CityMcpError` on failure.
 */
export async function searchCityPlaces(
  query: string,
  opts: SearchCityPlacesOpts = {},
): Promise<SearchPlacesRow[]> {
  const args: Record<string, unknown> = { query };
  if (typeof opts.limit === "number") args.limit = opts.limit;
  if (opts.near) args.near = opts.near;
  if (typeof opts.openNow === "boolean") args.openNow = opts.openNow;
  if (typeof opts.minRating === "number") args.minRating = opts.minRating;
  if (opts.maxPrice) args.maxPrice = opts.maxPrice;
  if (opts.sort) args.sort = opts.sort;
  const result = await callCityMcpTool<{ places?: unknown }>(
    "search_places",
    args,
    {
      timeoutMs: opts.timeoutMs,
      endpoint: opts.endpoint,
      fetchImpl: opts.fetchImpl,
    },
  );
  const places = result.structuredContent?.places;
  if (!Array.isArray(places)) return [];
  return places.filter((p): p is SearchPlacesRow => {
    return (
      p != null &&
      typeof p === "object" &&
      typeof (p as { id?: unknown }).id === "string" &&
      typeof (p as { name?: unknown }).name === "string"
    );
  });
}

// ---------- get_place: dossier fetch + short-TTL cache ----------

/**
 * Trimmed CityMCP place dossier the app is willing to render. This is a
 * defensive whitelist over the upstream `get_place` result — anything not
 * listed here is dropped before the value ever reaches the client so we
 * never leak giant raw dumps or invent fields.
 *
 * Only `deep:true` returns hygiene / transit / air / weather / michelin.
 * Every field is optional because the upstream may omit anything at any
 * time; the UI must render "nothing" rather than a fabricated fact.
 */
export type CityPlace = {
  id: string;
  name?: string;
  address?: string;
  area?: string;
  location?: { lat: number; lng: number };
  types?: string[];
  rating?: number;
  userRatingCount?: number;
  priceBand?: string;
  openNow?: boolean;
  hours?: string[];
  // Optional enrichment (deep:true) — each carries the source when present,
  // never faked. Keep shape flexible; UI checks `value`.
  hygiene?: {
    value?: { businessName?: string; rating?: string | number };
    source?: string;
    fetchedAt?: string;
  };
  transit?: {
    value?: {
      nearest?: string;
      lines?: string[];
      walkMinutes?: number;
      summary?: string;
    };
    source?: string;
  };
  air?: {
    value?: { index?: string | number; site?: string };
    source?: string;
  };
  weather?: {
    value?: {
      condition?: string;
      tempC?: number;
      precipProbabilityPct?: number;
    };
    source?: string;
  };
};

type PlaceCacheEntry = { value: CityPlace; expiresAt: number };
const placeCache = new Map<string, PlaceCacheEntry>();

/** Test-only: drop all cached place entries. */
export function resetCityPlaceCache(): void {
  placeCache.clear();
}

function pickNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}

function pickString(v: unknown): string | undefined {
  if (typeof v === "string" && v.length > 0) return v;
  return undefined;
}

function pickStringArray(v: unknown, cap = 8): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, cap);
  return out.length > 0 ? out : undefined;
}

function pickLocation(v: unknown): { lat: number; lng: number } | undefined {
  if (!v || typeof v !== "object") return undefined;
  const lat = pickNumber((v as { lat?: unknown }).lat);
  const lng = pickNumber((v as { lng?: unknown }).lng);
  if (lat === undefined || lng === undefined) return undefined;
  return { lat, lng };
}

function pickScalar(v: unknown): string | number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.length > 0) return v;
  return undefined;
}

function readEnrichmentBlock(
  raw: unknown,
): { value: Record<string, unknown>; source?: string; fetchedAt?: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const value = b.value && typeof b.value === "object" ? (b.value as Record<string, unknown>) : undefined;
  if (!value) return null;
  return { value, source: pickString(b.source), fetchedAt: pickString(b.fetchedAt) };
}

function trimHygiene(raw: unknown): CityPlace["hygiene"] {
  const block = readEnrichmentBlock(raw);
  if (!block) return undefined;
  const businessName = pickString(block.value.businessName);
  const rating = pickScalar(block.value.rating);
  if (!businessName && rating === undefined) return undefined;
  return {
    value: {
      ...(businessName ? { businessName } : {}),
      ...(rating !== undefined ? { rating } : {}),
    },
    source: block.source,
    fetchedAt: block.fetchedAt,
  };
}

function trimTransit(raw: unknown): CityPlace["transit"] {
  const block = readEnrichmentBlock(raw);
  if (!block) return undefined;
  const nearest = pickString(block.value.nearest);
  const lines = pickStringArray(block.value.lines, 4);
  const walkMinutes = pickNumber(block.value.walkMinutes);
  const summary = pickString(block.value.summary);
  if (!nearest && !lines && walkMinutes === undefined && !summary) return undefined;
  return {
    value: {
      ...(nearest ? { nearest } : {}),
      ...(lines ? { lines } : {}),
      ...(walkMinutes !== undefined ? { walkMinutes } : {}),
      ...(summary ? { summary } : {}),
    },
    source: block.source,
  };
}

function trimAir(raw: unknown): CityPlace["air"] {
  const block = readEnrichmentBlock(raw);
  if (!block) return undefined;
  const index = pickScalar(block.value.index);
  const site = pickString(block.value.site);
  if (index === undefined && !site) return undefined;
  return {
    value: {
      ...(index !== undefined ? { index } : {}),
      ...(site ? { site } : {}),
    },
    source: block.source,
  };
}

function trimPlaceWeather(raw: unknown): CityPlace["weather"] {
  const block = readEnrichmentBlock(raw);
  if (!block) return undefined;
  const condition = pickString(block.value.condition);
  const tempC = pickNumber(block.value.tempC);
  const precipProbabilityPct = pickNumber(block.value.precipProbabilityPct);
  if (!condition && tempC === undefined && precipProbabilityPct === undefined) return undefined;
  return {
    value: {
      ...(condition ? { condition } : {}),
      ...(tempC !== undefined ? { tempC } : {}),
      ...(precipProbabilityPct !== undefined ? { precipProbabilityPct } : {}),
    },
    source: block.source,
  };
}

/**
 * Whitelist/trim an upstream `get_place` structuredContent into `CityPlace`.
 * Every field is optional — we only surface upstream-provided values, never
 * invent hygiene/transit facts. Exported for tests.
 */
export function trimCityPlace(id: string, raw: unknown): CityPlace {
  const obj = (raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}) as Record<string, unknown>;
  const nested = obj.place && typeof obj.place === "object" ? (obj.place as Record<string, unknown>) : obj;

  const place: CityPlace = { id };
  const name = pickString(nested.name);
  if (name) place.name = name;
  const address = pickString(nested.address) ?? pickString(nested.formattedAddress);
  if (address) place.address = address;
  const area = pickString(nested.area);
  if (area) place.area = area;
  const location = pickLocation(nested.location);
  if (location) place.location = location;
  const types = pickStringArray(nested.types, 6);
  if (types) place.types = types;
  const rating = pickNumber(nested.rating);
  if (rating !== undefined) place.rating = rating;
  const userRatingCount = pickNumber(nested.userRatingCount);
  if (userRatingCount !== undefined) place.userRatingCount = userRatingCount;
  const priceBand = pickString(nested.priceBand);
  if (priceBand) place.priceBand = priceBand;
  if (typeof nested.openNow === "boolean") place.openNow = nested.openNow;
  const hours = pickStringArray(nested.hours, 8) ?? pickStringArray(nested.weekdayText, 8);
  if (hours) place.hours = hours;

  const hygiene = trimHygiene(nested.hygiene);
  if (hygiene) place.hygiene = hygiene;
  const transit = trimTransit(nested.transit);
  if (transit) place.transit = transit;
  const air = trimAir(nested.air);
  if (air) place.air = air;
  const weather = trimPlaceWeather(nested.weather);
  if (weather) place.weather = weather;

  return place;
}

export type FetchCityPlaceOpts = CityMcpCallOptions & { deep?: boolean };

/**
 * Fetch and trim a CityMCP `get_place` dossier. Cached in-process for ~10min
 * per (id, deep) tuple. Throws `CityMcpError` on failure — callers fail-soft.
 */
export async function fetchCityPlace(
  id: string,
  opts: FetchCityPlaceOpts = {},
): Promise<CityPlace> {
  if (!id) throw new CityMcpError("get_place: id is required", "empty");
  const deep = opts.deep === true;
  const cacheKey = `${deep ? "d" : "s"}:${id}`;
  const now = Date.now();
  const cached = placeCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;

  const args: Record<string, unknown> = { id };
  if (deep) args.deep = true;
  const result = await callCityMcpTool<unknown>("get_place", args, opts);
  const trimmed = trimCityPlace(id, result.structuredContent);
  placeCache.set(cacheKey, { value: trimmed, expiresAt: now + PLACE_TTL_MS });
  return trimmed;
}

// ---------- things_to_do: curated opportunities + short-TTL cache ----------

export type ThingsToDoWindow = "tonight" | "tomorrow_night" | "this_weekend";

export const THINGS_TO_DO_WINDOWS: readonly ThingsToDoWindow[] = [
  "tonight",
  "tomorrow_night",
  "this_weekend",
];

export type ThingsToDoKind =
  | "exhibition"
  | "gig"
  | "comedy"
  | "theatre"
  | "popup"
  | "food_drink"
  | "market"
  | "family"
  | "talk"
  | "nightlife"
  | "free_event"
  | "other";

export type ThingsToDoPrice = "any" | "cheap" | "free";

export type ThingsToDoOpportunity = {
  title: string;
  kind?: ThingsToDoKind | string;
  areas?: string[];
  price?: string;
  availability?: string;
  timeEvidence?: string;
  place?: {
    id?: string;
    name?: string;
    area?: string;
    location?: { lat: number; lng: number };
  };
  source?: { label?: string; url?: string };
};

export type ThingsToDoResult = {
  window: ThingsToDoWindow;
  area?: string;
  asOf?: string;
  opportunities: ThingsToDoOpportunity[];
};

type ThingsToDoCacheEntry = { value: ThingsToDoResult; expiresAt: number };
const thingsToDoCache = new Map<string, ThingsToDoCacheEntry>();

/** Test-only: drop all cached things_to_do entries. */
export function resetThingsToDoCache(): void {
  thingsToDoCache.clear();
}

function trimOpportunity(raw: unknown): ThingsToDoOpportunity | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const title = pickString(o.title);
  if (!title) return null;

  const out: ThingsToDoOpportunity = { title };
  const kind = pickString(o.kind);
  if (kind) out.kind = kind;
  const areas = pickStringArray(o.areas, 3);
  if (areas) out.areas = areas;
  const price = pickString(o.price);
  if (price) out.price = price;
  const availability = pickString(o.availability);
  if (availability) out.availability = availability;
  const timeEvidence = pickString(o.timeEvidence);
  if (timeEvidence) out.timeEvidence = timeEvidence;

  const place = o.place;
  if (place && typeof place === "object") {
    const p = place as Record<string, unknown>;
    const placeId = pickString(p.id);
    const placeName = pickString(p.name);
    const placeArea = pickString(p.area);
    const placeLoc = pickLocation(p.location);
    if (placeId || placeName || placeArea || placeLoc) {
      out.place = {
        ...(placeId ? { id: placeId } : {}),
        ...(placeName ? { name: placeName } : {}),
        ...(placeArea ? { area: placeArea } : {}),
        ...(placeLoc ? { location: placeLoc } : {}),
      };
    }
  }

  const source = o.source;
  if (source && typeof source === "object") {
    const s = source as Record<string, unknown>;
    const label = pickString(s.label);
    const url = pickString(s.url);
    if (label || url) {
      out.source = {
        ...(label ? { label } : {}),
        ...(url ? { url } : {}),
      };
    }
  }

  return out;
}

export type FetchThingsToDoOpts = CityMcpCallOptions & {
  window: ThingsToDoWindow;
  area?: string;
  kinds?: readonly ThingsToDoKind[];
  price?: ThingsToDoPrice;
  limit?: number;
};

/**
 * Fetch and trim CityMCP `things_to_do` opportunities for a plan window.
 * Cached in-process for ~5min per (window, area, kinds, price, limit) key.
 * Throws `CityMcpError` on failure — callers fail-soft.
 */
export async function fetchThingsToDo(
  opts: FetchThingsToDoOpts,
): Promise<ThingsToDoResult> {
  const { window, area, kinds, price, limit } = opts;
  if (!THINGS_TO_DO_WINDOWS.includes(window)) {
    throw new CityMcpError(`things_to_do: invalid window ${String(window)}`, "empty");
  }

  const args: Record<string, unknown> = { window };
  if (area) args.area = area;
  if (kinds && kinds.length > 0) args.kinds = [...kinds];
  if (price) args.price = price;
  if (typeof limit === "number" && limit > 0) args.limit = limit;

  const cacheKey = JSON.stringify(args);
  const now = Date.now();
  const cached = thingsToDoCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;

  const result = await callCityMcpTool<Record<string, unknown>>("things_to_do", args, opts);
  const structured = result.structuredContent ?? {};

  const rawOpps = Array.isArray(structured.opportunities) ? structured.opportunities : [];
  const opportunities: ThingsToDoOpportunity[] = [];
  for (const item of rawOpps) {
    const trimmed = trimOpportunity(item);
    if (trimmed) opportunities.push(trimmed);
    if (typeof limit === "number" && opportunities.length >= limit) break;
  }

  const value: ThingsToDoResult = {
    window,
    area: pickString(structured.area) ?? area,
    asOf: pickString(structured.asOf),
    opportunities,
  };
  thingsToDoCache.set(cacheKey, { value, expiresAt: now + THINGS_TO_DO_TTL_MS });
  return value;
}

// ---------- Signal trimming (shared by /api/citymcp/status) ----------

const SEVERITY_ORDER: Record<string, number> = {
  major: 3,
  notable: 2,
  info: 1,
};

/**
 * Return the top-N signals by severity (major > notable > info > unknown),
 * preserving upstream order for equal severities. Used by the status route
 * to keep the UI banner compact. Exported for tests.
 */
export function trimSignals(
  signals: readonly CityStatusSignal[] | undefined,
  limit: number,
): CityStatusSignal[] {
  if (!Array.isArray(signals) || signals.length === 0) return [];
  if (limit <= 0) return [];
  const decorated = signals.map((s, idx) => ({
    s,
    idx,
    rank: SEVERITY_ORDER[String(s.severity ?? "").toLowerCase()] ?? 0,
  }));
  decorated.sort((a, b) => b.rank - a.rank || a.idx - b.idx);
  return decorated.slice(0, limit).map((d) => d.s);
}
