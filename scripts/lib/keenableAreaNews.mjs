import { createHash } from "node:crypto";
import canonicalAreaSlugs from "../../data/area_news_areas.json" with { type: "json" };

export const KEENABLE_API_BASE = "https://api.keenable.ai";
export const KEENABLE_TITLE = "PUBMAXX area news refresh";

export const KNOWN_AREA_SLUGS = new Set(canonicalAreaSlugs);

const KINDS = new Set(["opening", "closure", "refurb", "award", "threat", "buzz"]);
const DAY_MS = 24 * 60 * 60 * 1000;

export const AREA_NEWS_EXTRACT_PROMPT = `Return JSON only with keys area, kind, title, detail for one real London pub fact explicitly stated on this page. Use area as one of ${[...KNOWN_AREA_SLUGS].join(", ")}, or null if no named pub fact maps to one of those areas. Use kind opening for a new opening, closure for a closing, refurb for refurbishment, award for an award, threat for a risk or licensing threat, and buzz for a current price or other pub news. The fact itself must describe a current 2026 event or status, not a historical fact mentioned in a new article. Do not infer or invent facts. Do not include em dashes or en dashes.`;

function apiUrl(apiBase, path, key) {
  const base = apiBase.replace(/\/$/, "");
  return `${base}${key ? path : `${path}/public`}`;
}

function apiKey(env) {
  const value = env?.KEENABLE_API_KEY;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requestHeaders(key, title) {
  return key
    ? { "X-API-Key": key, "content-type": "application/json" }
    : { "X-Keenable-Title": title, "content-type": "application/json" };
}

async function readJson(response, operation) {
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Keenable ${operation} returned ${response.status}.`);
  }

  try {
    return JSON.parse(bodyText);
  } catch {
    throw new Error(`Keenable ${operation} returned malformed JSON.`);
  }
}

export async function searchKeenable(
  query,
  {
    env = process.env,
    fetchImpl = fetch,
    apiBase = KEENABLE_API_BASE,
    title = KEENABLE_TITLE,
    publishedAfter,
    publishedBefore,
    queryTime,
    maxResults = 10,
    snippetMaxLength = 1200,
  } = {},
) {
  if (typeof query !== "string" || !query.trim()) {
    throw new Error("Keenable search query is required.");
  }

  const key = apiKey(env);
  const body = {
    query: query.trim(),
    max_results: maxResults,
    snippet_max_length: snippetMaxLength,
  };
  if (publishedAfter) body.published_after = publishedAfter;
  if (publishedBefore) body.published_before = publishedBefore;
  if (queryTime) body.query_time = queryTime;

  const response = await fetchImpl(apiUrl(apiBase, "/v1/search", key), {
    method: "POST",
    headers: requestHeaders(key, title),
    body: JSON.stringify(body),
  });
  const payload = await readJson(response, "search");
  if (!Array.isArray(payload?.results)) {
    throw new Error("Keenable search response did not contain results.");
  }
  return payload.results;
}

export async function fetchKeenable(
  sourceUrl,
  {
    env = process.env,
    fetchImpl = fetch,
    apiBase = KEENABLE_API_BASE,
    title = KEENABLE_TITLE,
    maxChars = 6000,
    prompt = AREA_NEWS_EXTRACT_PROMPT,
  } = {},
) {
  let parsedUrl;
  try {
    parsedUrl = new URL(sourceUrl);
  } catch {
    throw new Error("Keenable fetch requires a valid source URL.");
  }
  if (parsedUrl.protocol !== "https:") {
    throw new Error("Keenable fetch requires an https source URL.");
  }

  const key = apiKey(env);
  const params = new URLSearchParams({
    url: parsedUrl.toString(),
    max_chars: String(maxChars),
  });
  if (prompt) params.set("prompt", prompt);

  const response = await fetchImpl(`${apiUrl(apiBase, "/v1/fetch", key)}?${params}`, {
    headers: key ? { "X-API-Key": key } : { "X-Keenable-Title": title },
  });
  const payload = await readJson(response, "fetch");
  if (typeof payload?.content !== "string" || !payload.content.trim()) {
    throw new Error("Keenable fetch response did not contain content.");
  }
  return payload;
}

function parseJsonText(content) {
  if (typeof content !== "string") return null;
  const trimmed = content.trim();
  if (!trimmed || trimmed === "null") return null;

  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(withoutFence.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function parseExtractedFact(payload, { knownAreas = KNOWN_AREA_SLUGS } = {}) {
  const raw = parseJsonText(payload?.content);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const area = cleanText(raw.area);
  const kind = cleanText(raw.kind);
  const title = cleanText(raw.title);
  const detail = cleanText(raw.detail);
  if (!knownAreas.has(area) || !KINDS.has(kind) || !title || !detail) return null;
  if (/[—–]/u.test(`${title} ${detail}`)) return null;
  if (title.length > 180 || detail.length > 500) return null;

  return { area, kind, title, detail };
}

function publishedTime(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

function sourceName(sourceUrl) {
  const host = new URL(sourceUrl).hostname.toLowerCase();
  return host.startsWith("www.") ? host.slice(4) : host;
}

export function buildAreaNewsEntry({ result, page, fact, now = Date.now(), knownAreas = KNOWN_AREA_SLUGS } = {}) {
  const validFact = parseExtractedFact({ content: JSON.stringify(fact) }, { knownAreas });
  if (!validFact) return null;

  const candidateUrl = page?.url || result?.url;
  let url;
  try {
    url = new URL(candidateUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;

  const publishedAt = publishedTime(page?.published_at ?? result?.published_at);
  if (!Number.isFinite(publishedAt)) return null;
  const nowTime = typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(nowTime) || publishedAt > nowTime) return null;

  const nowDay = new Date(nowTime);
  nowDay.setUTCHours(0, 0, 0, 0);
  const publishedDay = new Date(publishedAt);
  publishedDay.setUTCHours(0, 0, 0, 0);
  if (publishedDay.getTime() < nowDay.getTime() - 21 * DAY_MS) return null;

  const sourceUrl = url.toString();
  const idSeed = `${validFact.area}|${validFact.kind}|${sourceUrl}|${validFact.title}`;
  const id = `area-news-${createHash("sha256").update(idSeed).digest("hex").slice(0, 16)}`;
  return {
    id,
    ...validFact,
    sourceUrl,
    sourceName: sourceName(sourceUrl),
    observedAt: publishedDay.toISOString().slice(0, 10),
  };
}
