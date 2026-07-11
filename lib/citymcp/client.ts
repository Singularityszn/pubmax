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
