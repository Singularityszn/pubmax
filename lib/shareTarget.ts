export type ShareTargetParams = {
  title?: string | string[];
  text?: string | string[];
  url?: string | string[];
};

export type ShareTargetDecision = {
  title: string;
  body: string;
  primaryHref: string;
  primaryLabel: string;
  sourceUrl: string | null;
  query: string | null;
  kind: "empty" | "internal" | "map-query";
};

const MAX_FIELD_LENGTH = 500;
const PUBMAX_HOSTS = new Set(["pubmaxxing.com", "www.pubmaxxing.com", "localhost"]);
const GOOGLE_MAPS_HOSTS = new Set([
  "google.com",
  "www.google.com",
  "maps.google.com",
  "maps.google.co.uk",
]);
const SHORT_MAP_HOSTS = new Set(["maps.app.goo.gl", "goo.gl"]);

function firstParam(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return normalize(raw ?? "");
}

function normalize(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_FIELD_LENGTH);
}

function stripUrlPunctuation(value: string): string {
  return value.replace(/[),.;:!?]+$/g, "");
}

export function extractFirstHttpUrl(value: string): string | null {
  const match = value.match(/https?:\/\/[^\s<>"']+/i);
  return match ? stripUrlPunctuation(match[0]!) : null;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replaceAll("+", " "));
  } catch {
    return value.replaceAll("+", " ");
  }
}

function isPubmaxUrl(url: URL): boolean {
  return PUBMAX_HOSTS.has(url.hostname.toLowerCase());
}

function internalHref(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}` || "/";
}

function cleanQuery(value: string): string {
  return normalize(value)
    .replace(/https?:\/\/[^\s<>"']+/gi, "")
    .replace(/\b(?:google maps|apple maps|maps|tripadvisor|instagram|tiktok)\b/gi, "")
    .replace(/\b(?:check this out|check out|shared from|i found|visit)\b/gi, "")
    .replace(/\s+[-|•]\s*$/g, "")
    .replace(/^[\s:;,.|•-]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function sharedMapPlace(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  const queryValue =
    url.searchParams.get("query") ??
    url.searchParams.get("q") ??
    url.searchParams.get("address");

  if (host === "maps.apple.com" || GOOGLE_MAPS_HOSTS.has(host)) {
    const cleanedQuery = queryValue ? cleanQuery(safeDecode(queryValue)) : "";
    if (cleanedQuery) return cleanedQuery;
  }

  if (GOOGLE_MAPS_HOSTS.has(host)) {
    const segments = url.pathname.split("/").filter(Boolean);
    const placeIndex = segments.findIndex((segment) => segment.toLowerCase() === "place");
    const place = placeIndex >= 0 ? segments[placeIndex + 1] : undefined;
    const cleanedPlace = place ? cleanQuery(safeDecode(place)) : "";
    if (cleanedPlace && !cleanedPlace.startsWith("@")) return cleanedPlace;
  }

  return null;
}

function externalLabel(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, "");
  if (SHORT_MAP_HOSTS.has(host.toLowerCase())) return null;
  const path = safeDecode(url.pathname)
    .split("/")
    .filter(Boolean)
    .slice(-1)[0]
    ?.replace(/[-_+]/g, " ");
  return cleanQuery(path ? `${path} ${host}` : host) || null;
}

export function resolveShareTarget(params: ShareTargetParams): ShareTargetDecision {
  const title = firstParam(params.title);
  const text = firstParam(params.text);
  const rawUrl = firstParam(params.url);
  const discoveredUrl = rawUrl || extractFirstHttpUrl(`${title} ${text}`);
  const parsedUrl = discoveredUrl ? parseUrl(discoveredUrl) : null;

  if (parsedUrl && isPubmaxUrl(parsedUrl)) {
    return {
      title: title || "Open shared PUBMAXX link",
      body: "This is already a PUBMAXX link.",
      primaryHref: internalHref(parsedUrl),
      primaryLabel: "Open link",
      sourceUrl: parsedUrl.toString(),
      query: null,
      kind: "internal",
    };
  }

  const query =
    cleanQuery(title) ||
    cleanQuery(text) ||
    (parsedUrl ? sharedMapPlace(parsedUrl) : null) ||
    (parsedUrl ? externalLabel(parsedUrl) : null) ||
    null;

  if (!query) {
    return {
      title: "Send pubs to PUBMAXX",
      body: "Share a pub name, map link, or crawl link from your phone and PUBMAXX will turn it into a map search.",
      primaryHref: "/map",
      primaryLabel: "Open map",
      sourceUrl: parsedUrl?.toString() ?? null,
      query: null,
      kind: "empty",
    };
  }

  return {
    title: query,
    body: "PUBMAXX will search the live pint map for this and keep you inside the mobile app shell.",
    primaryHref: `/map?q=${encodeURIComponent(query)}&intent=share`,
    primaryLabel: "Search map",
    sourceUrl: parsedUrl?.toString() ?? null,
    query,
    kind: "map-query",
  };
}
