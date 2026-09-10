import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";

const POSTHOG_EU_INGEST_ORIGIN = "https://eu.i.posthog.com";
const POSTHOG_EU_ASSET_ORIGIN = "https://eu-assets.i.posthog.com";
const MAX_REQUEST_BYTES = 1024 * 1024;
// Per-address budget (Astra P2-1). Every request through here lands in the
// billed EU project, and nothing but the origin pin stood between a scripted
// loop and 1 MB a request. One device's SDK flushes events about every three
// seconds and replay about as often, so a phone spends under 40 a minute; 240
// covers a table of phones sharing one carrier address and walls a loop. Not
// paid spend, so the limiter's default fail-open degradation is fine here.
// `__tests__/posthogProxyRoute.test.ts` names the same number.
const RATE_LIMIT = 240;
const RATE_WINDOW_MS = 60_000;
const SAFE_REQUEST_CONTENT_TYPES = new Set([
  "application/json",
  "application/octet-stream",
  "application/x-www-form-urlencoded",
  "text/plain",
]);
const SAFE_RESPONSE_HEADERS = [
  "cache-control",
  "content-type",
  "etag",
  "last-modified",
] as const;

type Context = { params: Promise<{ path: string[] }> };

function ingestOrigin(): string {
  const configuredOrigin = process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim();
  return configuredOrigin === POSTHOG_EU_INGEST_ORIGIN
    ? configuredOrigin
    : POSTHOG_EU_INGEST_ORIGIN;
}

function upstreamUrl(request: Request, path: string[]): URL | null {
  if (path.length === 0 || path.some((segment) => segment.length === 0)) return null;

  const origin = path[0] === "static" || path[0] === "array"
    ? POSTHOG_EU_ASSET_ORIGIN
    : ingestOrigin();
  const requestUrl = new URL(request.url);
  const trailingSlash = requestUrl.pathname.endsWith("/") ? "/" : "";
  const url = new URL(`${path.map(encodeURIComponent).join("/")}${trailingSlash}`, `${origin}/`);
  url.search = requestUrl.search;
  return url;
}

function upstreamRequestHeaders(request: Request): Headers | null {
  const headers = new Headers({ accept: "*/*" });
  const rawContentType = request.headers.get("content-type");
  if (!rawContentType) return headers;

  const contentType = rawContentType.split(";", 1)[0]?.trim().toLowerCase();
  if (!contentType || !SAFE_REQUEST_CONTENT_TYPES.has(contentType)) return null;
  headers.set("content-type", contentType);
  return headers;
}

function downstreamResponseHeaders(upstream: Response): Headers {
  const headers = new Headers();
  for (const name of SAFE_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return headers;
}

async function boundedBody(request: Request): Promise<ArrayBuffer | null> {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (!Number.isFinite(declaredBytes) || declaredBytes < 0 || declaredBytes > MAX_REQUEST_BYTES) {
      return null;
    }
  }
  if (!request.body) return new ArrayBuffer(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_REQUEST_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}

function refusal(status: number): Response {
  return new Response(null, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

async function forward(request: Request, context: Context): Promise<Response> {
  const limiterKey = `ingest:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, RATE_LIMIT, RATE_WINDOW_MS)) {
    return refusal(429);
  }

  const { path } = await context.params;
  const url = upstreamUrl(request, path);
  if (!url) return new Response(null, { status: 404 });

  const headers = upstreamRequestHeaders(request);
  if (!headers) return new Response(null, { status: 415 });

  let body: ArrayBuffer | undefined;
  if (request.method === "POST") {
    const bounded = await boundedBody(request);
    if (!bounded) return new Response(null, { status: 413 });
    body = bounded;
  }

  try {
    const upstream = await fetch(url, {
      method: request.method,
      headers,
      ...(body ? { body } : {}),
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: downstreamResponseHeaders(upstream),
    });
  } catch {
    return refusal(502);
  }
}

export async function GET(request: Request, context: Context): Promise<Response> {
  return forward(request, context);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  return forward(request, context);
}
