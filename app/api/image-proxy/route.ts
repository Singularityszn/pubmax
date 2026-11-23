// Same-origin image proxy for scraped-pub photos (U4).
//
// The client loads /api/image-proxy?src=<https url> so remote photo hosts do
// not need entries in the browser's img-src policy. See the image proxy risk
// and mitigation contract in docs/SECURITY_POSTURE.md. The browser permits
// this same-origin request under img-src 'self'. This route fetches the
// remote image server-side under tight rules:
//   - https only; hostname must not be an IP literal / localhost (SSRF guard)
//   - the existing venue-image blocklist applies
//   - redirects followed manually, at most 1 hop, re-validated
//   - response must be a raster type from a closed set, capped at 8 MB; the
//     answer names that type itself and is sandboxed, never the upstream header
//   - no cookies or credentials are forwarded either way
// Responses are long-cached: scraped photos change on scrape cadence, and the
// URL is the cache key.

import sharp from "sharp";

import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";
import { allowedVenueImageHosts } from "@/lib/venueImageHosts.server";
import { directVenueImageUrl, isVenueImageWidth } from "@/lib/venueImages";

const MAX_BYTES = 8 * 1024 * 1024;
// Per-IP rate limit (cursor bot, round 3): each request costs us an outbound
// fetch + up to 8 MB of buffering, so an unauthenticated hot loop is a cheap
// amplification vector. A page renders at most a couple dozen proxied images,
// so 120/min per IP is generous for humans and a wall for loops. Not paid
// spend → the limiter's default fail-open degradation is fine here.
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 1;
const CACHE_CONTROL = "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400";
// Quality for a resized answer. Measured on /pubs's own five photographs: the
// five went from 792 KB at their natural size to well under a tenth of that at
// the width the 344x168 card really draws.
const RESIZE_QUALITY = 72;
// The only types the proxy answers with, keyed by the upstream media type.
// Echoing the upstream header would let a host send `image/png, text/html`,
// which a browser renders as a same-origin page. SVG is executable content.
const RASTER_TYPES: ReadonlyMap<string, string> = new Map([
  ["image/jpeg", "image/jpeg"],
  ["image/jpg", "image/jpeg"],
  ["image/png", "image/png"],
  ["image/webp", "image/webp"],
  ["image/gif", "image/gif"],
  ["image/avif", "image/avif"],
]);
const SANDBOX_CSP = "default-src 'none'; sandbox";

/** The raster type to answer with, or null when the upstream type is not one. */
function rasterType(header: string): string | null {
  if (header.includes(",")) return null;
  const essence = header.split(";", 1)[0]?.trim() ?? "";
  return RASTER_TYPES.get(essence) ?? null;
}

/**
 * The width this request asked for, or null for the original bytes.
 *
 * `w` is honoured ONLY for a width in the closed set. Anything else is read as
 * no width at all rather than refused, because the picture is what the caller
 * came for and an unknown width is our vocabulary problem, not a broken image.
 */
function requestedWidth(params: URLSearchParams): number | null {
  const raw = params.get("w");
  if (!raw) return null;
  const width = Number(raw);
  return Number.isInteger(width) && isVenueImageWidth(width) ? width : null;
}

/**
 * Resize to the asked-for width and re-encode as WebP.
 *
 * Never ENLARGES: `withoutEnlargement` means a source narrower than the ask is
 * answered at its own width, so a small photograph is never blown up into more
 * bytes than it started with.
 *
 * A failure here is about us rather than about the picture, so the original
 * bytes are served instead. The reader gets a heavy image, which is what they
 * got before this existed, rather than no image at all.
 */
async function resized(
  body: Uint8Array,
  width: number,
): Promise<{ bytes: Uint8Array; type: string } | null> {
  try {
    const out = await sharp(body)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: RESIZE_QUALITY })
      .toBuffer();
    return { bytes: new Uint8Array(out), type: "image/webp" };
  } catch {
    return null;
  }
}

function cacheableImageMiss(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "cache-control": CACHE_CONTROL,
      "x-content-type-options": "nosniff",
    },
  });
}

async function cancelUpstreamBody(response: Response | null): Promise<void> {
  try {
    await response?.body?.cancel();
  } catch {
    // The body can already be closed or aborted. Either state releases it.
  }
}

function isForbiddenHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) {
    return true;
  }
  // IPv4 literal (covers 127.x, 10.x, 169.254.x, everything — a public site
  // serving images bare-IP is not a case we need).
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  // IPv6 literal.
  if (h.startsWith("[") || h.includes(":")) return true;
  return false;
}

function validate(raw: string): URL | null {
  // Reuse the app's venue-image normaliser + blocklist.
  const cleaned = directVenueImageUrl(raw);
  if (!cleaned) return null;
  let url: URL;
  try {
    url = new URL(cleaned);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (isForbiddenHost(url.hostname)) return null;
  // User input must not widen the committed photo-host set. DNS rebinding
  // remains an accepted risk in docs/SECURITY_POSTURE.md.
  if (!allowedVenueImageHosts().has(url.hostname.toLowerCase())) return null;
  return url;
}

export async function GET(request: Request): Promise<Response> {
  const limiterKey = `image-proxy:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, RATE_LIMIT, RATE_WINDOW_MS)) {
    return new Response("Too many image requests, slow down.", { status: 429 });
  }

  const params = new URL(request.url).searchParams;
  const src = params.get("src") ?? "";
  const initial = validate(src);
  if (!initial) return new Response("Bad image source.", { status: 400 });
  const width = requestedWidth(params);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let target: URL = initial;
    let upstream: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      upstream = await fetch(target, {
        redirect: "manual",
        signal: controller.signal,
        headers: { accept: "image/*", "user-agent": "pubmaxxing-image-proxy" },
      });
      if (upstream.status >= 300 && upstream.status < 400) {
        const location = upstream.headers.get("location");
        await cancelUpstreamBody(upstream);
        let followed: URL | null = null;
        if (location) {
          try {
            followed = validate(new URL(location, target).toString());
          } catch {
            followed = null;
          }
        }
        if (!followed || hop === MAX_REDIRECTS) {
          return new Response("Image source redirected out of policy.", { status: 502 });
        }
        target = followed;
        continue;
      }
      break;
    }
    if (!upstream) return new Response("Image source unavailable.", { status: 502 });
    if (!upstream.ok) {
      await cancelUpstreamBody(upstream);
      return upstream.status === 404 || upstream.status === 410
        ? cacheableImageMiss()
        : new Response("Image source unavailable.", { status: 502 });
    }
    const header = (upstream.headers.get("content-type") ?? "").toLowerCase();
    if (!header.startsWith("image/")) {
      await cancelUpstreamBody(upstream);
      return cacheableImageMiss();
    }
    const type = rasterType(header);
    if (!type) {
      await cancelUpstreamBody(upstream);
      return new Response("Not an image.", { status: 502 });
    }
    const declared = Number(upstream.headers.get("content-length") ?? "0");
    if (declared > MAX_BYTES) {
      controller.abort();
      await cancelUpstreamBody(upstream);
      return new Response("Image too large.", { status: 502 });
    }
    // Stream with a hard byte cap (cursor bot, PR #171): a chunked/mislabelled
    // response is aborted the moment it crosses the cap, never fully buffered.
    const reader = upstream.body?.getReader();
    if (!reader) return cacheableImageMiss();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_BYTES) {
        controller.abort();
        return new Response("Image too large.", { status: 502 });
      }
      chunks.push(value);
    }
    if (received === 0) return cacheableImageMiss();
    const original = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      original.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const answer = width ? await resized(original, width) : null;
    return new Response(new Blob([(answer?.bytes ?? original) as BlobPart]), {
      status: 200,
      headers: {
        "content-type": answer?.type ?? type,
        "cache-control": CACHE_CONTROL,
        "x-content-type-options": "nosniff",
        "content-security-policy": SANDBOX_CSP,
      },
    });
  } catch {
    return new Response("Image source unavailable.", { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
