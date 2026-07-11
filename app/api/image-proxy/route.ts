// Same-origin image proxy for scraped-pub photos (U4).
//
// The venue enrichment data carries photo URLs on ~150 distinct pub-website
// hosts — an open-ended set, so a CSP img-src allowlist can't cover it and
// the browser was blocking the images (silent gradient fallbacks on /pubs and
// the venue sheet). Instead the client loads /api/image-proxy?src=<https url>
// (same-origin, already allowed by img-src 'self') and THIS route fetches the
// remote image server-side under tight rules:
//   - https only; hostname must not be an IP literal / localhost (SSRF guard)
//   - the existing venue-image blocklist applies
//   - redirects followed manually, at most 1 hop, re-validated
//   - response must be an image/* content type, capped at 8 MB
//   - no cookies or credentials are forwarded either way
// Responses are long-cached: scraped photos change on scrape cadence, and the
// URL is the cache key.

import { directVenueImageUrl } from "@/lib/venueImages";

const MAX_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 1;

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
  return url;
}

export async function GET(request: Request): Promise<Response> {
  const src = new URL(request.url).searchParams.get("src") ?? "";
  const initial = validate(src);
  if (!initial) return new Response("Bad image source.", { status: 400 });

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
        const followed: URL | null = location
          ? validate(new URL(location, target).toString())
          : null;
        if (!followed || hop === MAX_REDIRECTS) {
          return new Response("Image source redirected out of policy.", { status: 502 });
        }
        target = followed;
        continue;
      }
      break;
    }
    if (!upstream || !upstream.ok) {
      return new Response("Image source unavailable.", { status: 502 });
    }
    const type = upstream.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) {
      return new Response("Not an image.", { status: 502 });
    }
    const declared = Number(upstream.headers.get("content-length") ?? "0");
    if (declared > MAX_BYTES) return new Response("Image too large.", { status: 502 });
    const body = await upstream.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return new Response("Image too large.", { status: 502 });
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": type,
        "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response("Image source unavailable.", { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
