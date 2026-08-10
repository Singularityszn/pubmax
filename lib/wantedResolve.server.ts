// Server-side Wanted paste resolve: licensed public metadata + curated venue
// index + national UK base search. Ambiguous matches stay as candidates for the
// drinker to confirm - never auto-confirm a priced pin.

import { searchCuratedVenues } from "@/lib/curatedVenueSearch.server";
import { searchUkNationalPubs } from "@/lib/ukNationalPubSearch.server";
import { cleanText } from "@/lib/textClean";
import {
  splitWantedPaste,
  type WantedResolveCandidate,
  type WantedResolveResult,
} from "@/lib/wanted";

export type { WantedResolveCandidate, WantedResolveResult };

// The matcher itself is `lib/curatedVenueSearch.server.ts`, shared with the pub
// a drinker attaches to a message: two surfaces asking "which pub did you mean"
// must answer the same, and a copied matcher is how they stop.
async function searchCuratedPubs(
  rawQuery: string,
  limit: number,
): Promise<WantedResolveCandidate[]> {
  const hits = await searchCuratedVenues(rawQuery, limit);
  return hits.map((hit) => ({
    venueId: hit.id,
    venueName: hit.name,
    venueKind: "curated" as const,
    address: "",
    contextLabel: hit.area,
  }));
}

const OEMBED_TIMEOUT_MS = 2_500;
const OEMBED_MAX_BODY_BYTES = 128 * 1024;
const OEMBED_TITLE_MAX = 180;

type OEmbedProvider = {
  host: string;
  endpoint: string;
  requiresToken?: boolean;
};

const OEMBED_PROVIDERS: Readonly<Record<string, OEmbedProvider>> = {
  youtube: {
    host: "www.youtube.com",
    endpoint: "https://www.youtube.com/oembed",
  },
  tiktok: {
    host: "www.tiktok.com",
    endpoint: "https://www.tiktok.com/oembed",
  },
  instagram: {
    host: "graph.facebook.com",
    endpoint: "https://graph.facebook.com/v22.0/instagram_oembed",
    requiresToken: true,
  },
};

function isExactProviderHost(sourceUrl: string, platform: string): boolean {
  try {
    const parsed = new URL(sourceUrl);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    return platform === "youtube"
      ? ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(host)
      : platform === "tiktok"
        ? ["tiktok.com", "www.tiktok.com", "vm.tiktok.com"].includes(host)
        : platform === "instagram"
          ? ["instagram.com", "www.instagram.com"].includes(host)
          : false;
  } catch {
    return false;
  }
}

function providerRequestUrl(sourceUrl: string, platform: string): string | null {
  const provider = OEMBED_PROVIDERS[platform];
  if (!provider || !isExactProviderHost(sourceUrl, platform)) return null;
  if (provider.requiresToken && !process.env.INSTAGRAM_OEMBED_ACCESS_TOKEN?.trim()) {
    return null;
  }
  const endpoint = new URL(provider.endpoint);
  endpoint.searchParams.set("url", sourceUrl);
  endpoint.searchParams.set("format", "json");
  if (provider.requiresToken) {
    // The token is sent only to Meta's fixed oEmbed origin. It never enters a
    // user-facing result, URL log, or error message.
    endpoint.searchParams.set(
      "access_token",
      process.env.INSTAGRAM_OEMBED_ACCESS_TOKEN?.trim() ?? "",
    );
  }
  return endpoint.toString();
}

async function readBoundedJson(response: Response): Promise<Record<string, unknown> | null> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > OEMBED_MAX_BODY_BYTES) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      received += part.value.byteLength;
      if (received > OEMBED_MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const text = new TextDecoder().decode(
    chunks.reduce((all, chunk) => {
      const next = new Uint8Array(all.length + chunk.length);
      next.set(all);
      next.set(chunk, all.length);
      return next;
    }, new Uint8Array()),
  );
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function resolvePublicMetadata(
  sourceUrl: string,
  sourcePlatform: string,
): Promise<{ status: "ready" | "degraded"; query: string }> {
  if (!(sourcePlatform in OEMBED_PROVIDERS)) {
    // Unknown links remain provenance only. They are not a provider failure and
    // must never be used as an outbound fetch target.
    return { status: "ready", query: "" };
  }
  if (!isExactProviderHost(sourceUrl, sourcePlatform)) {
    // A recognised provider URL that fails the transport/host allowlist is a
    // degraded resolution, not permission to pass it to another fetch path.
    return { status: "degraded", query: "" };
  }
  const requestUrl = providerRequestUrl(sourceUrl, sourcePlatform);
  if (!requestUrl) return { status: "degraded", query: "" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OEMBED_TIMEOUT_MS);
  try {
    const response = await fetch(requestUrl, {
      redirect: "manual",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "PUBMAXX-wanted-resolver/1",
      },
    });
    if (!response.ok || (response.status >= 300 && response.status < 400)) {
      return { status: "degraded", query: "" };
    }
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.includes("json")) return { status: "degraded", query: "" };
    const metadata = await readBoundedJson(response);
    const title = cleanText(metadata?.title, OEMBED_TITLE_MAX);
    return title
      ? { status: "ready", query: title }
      : { status: "degraded", query: "" };
  } catch {
    return { status: "degraded", query: "" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve a Wanted paste into confirmable candidates.
 * Curated hits lead; national UK-base hits follow, deduped by id.
 */
export async function resolveWantedPaste(
  raw: string,
  limit = 8,
): Promise<WantedResolveResult> {
  const split = splitWantedPaste(raw);
  if (!split.query && !split.sourceUrl) {
    return {
      query: "",
      sourceUrl: "",
      sourcePlatform: "none",
      rawPaste: "",
      status: "empty_query",
      candidates: [],
    };
  }
  if (!split.query) {
    // Bare social URL: use only the provider's licensed public oEmbed endpoint.
    // A provider outage or missing capability stays degraded and never becomes
    // a guessed venue.
    const metadata = await resolvePublicMetadata(split.sourceUrl, split.sourcePlatform);
    if (metadata.query) {
      const [curated, national] = await Promise.all([
        searchCuratedPubs(metadata.query, Math.max(1, Math.ceil(limit / 2))),
        Promise.resolve(searchUkNationalPubs(metadata.query, Math.max(1, limit))),
      ]);
      const seen = new Set(curated.map((candidate) => candidate.venueId));
      const baseHits = national.hits.flatMap((hit) => {
        if (seen.has(hit.id)) return [];
        seen.add(hit.id);
        return [{
          venueId: hit.id,
          venueName: hit.name,
          venueKind: "uk_base" as const,
          address: hit.address,
          contextLabel: hit.address,
        }];
      });
      return {
        query: metadata.query,
        sourceUrl: split.sourceUrl,
        sourcePlatform: split.sourcePlatform,
        rawPaste: split.rawPaste,
        status: national.status === "degraded" && curated.length === 0 ? "degraded" : metadata.status,
        candidates: [...curated, ...baseHits].slice(0, limit),
      };
    }
    return {
      query: "",
      sourceUrl: split.sourceUrl,
      sourcePlatform: split.sourcePlatform,
      rawPaste: split.rawPaste,
      status: metadata.status,
      candidates: [],
    };
  }

  const curatedLimit = Math.max(1, Math.ceil(limit / 2));
  const nationalLimit = Math.max(1, limit);
  const [curated, national] = await Promise.all([
    searchCuratedPubs(split.query, curatedLimit),
    Promise.resolve(searchUkNationalPubs(split.query, nationalLimit)),
  ]);

  const seen = new Set(curated.map((c) => c.venueId));
  const baseHits: WantedResolveCandidate[] = [];
  for (const hit of national.hits) {
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);
    baseHits.push({
      venueId: hit.id,
      venueName: hit.name,
      venueKind: "uk_base",
      address: hit.address,
      contextLabel: hit.address,
    });
  }

  const candidates = [...curated, ...baseHits].slice(0, limit);
  const status =
    national.status === "degraded" && curated.length === 0 ? "degraded" : "ready";

  return {
    query: split.query,
    sourceUrl: split.sourceUrl,
    sourcePlatform: split.sourcePlatform,
    rawPaste: split.rawPaste,
    status,
    candidates,
  };
}
