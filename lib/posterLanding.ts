import type { Route } from "next";

// Physical QR poster arrival (PLG Wave 2). Printed codes point at a short link,
// `/get/<code>` (lib/posterCodes.ts), or at `/?src=poster` with utm_* tags. Both
// land on `/near` with src=poster and the campaign query kept, so a scan opens
// nearby prices rather than the marketing landing. See docs/growth/POSTER_SPEC.md.

export const POSTER_LANDING_SRC = "poster";

/** The printed things a scan can come from. `utm_medium` carries one of them. */
const POSTER_MEDIA = ["poster", "beermat"] as const;
export type PosterMedium = (typeof POSTER_MEDIA)[number];

export function isPosterMedium(value: unknown): value is PosterMedium {
  return typeof value === "string" && (POSTER_MEDIA as readonly string[]).includes(value);
}

const POSTER_MEDIUM_NOUNS: Record<PosterMedium, string> = {
  poster: "a pub poster",
  beermat: "a beer mat",
};

/** Session flag so /near still knows the arrival after a later URL rewrite. */
export const POSTER_LANDING_SESSION_KEY = "pubmax:poster-landing";

const KEPT_QUERY_KEYS = new Set(["src"]);

type SearchParamRecord = Record<string, string | string[] | undefined>;

/** True when the campaign tag is exactly the closed poster source. */
export function isPosterLandingSrc(
  value: string | null | undefined,
): boolean {
  return value === POSTER_LANDING_SRC;
}

/** Keep src=poster and every utm_* tag; drop free-form junk. */
export function shouldKeepPosterLandingParam(key: string): boolean {
  return KEPT_QUERY_KEYS.has(key) || key.startsWith("utm_");
}

function appendKeptParams(
  out: URLSearchParams,
  key: string,
  value: string | string[] | undefined,
): void {
  if (!shouldKeepPosterLandingParam(key)) return;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && item.length > 0) out.append(key, item);
    }
    return;
  }
  if (typeof value === "string" && value.length > 0) out.set(key, value);
}

/**
 * Build the /near href for a poster arrival. Always pins src=poster so the
 * orientation line and analytics have a stable query flag even if the inbound
 * record was sparse.
 */
export function posterNearHref(from: SearchParamRecord | URLSearchParams): Route {
  const out = new URLSearchParams();
  if (from instanceof URLSearchParams) {
    for (const [key, value] of from.entries()) {
      if (!shouldKeepPosterLandingParam(key)) continue;
      if (value.length > 0) out.append(key, value);
    }
  } else {
    for (const [key, value] of Object.entries(from)) {
      appendKeptParams(out, key, value);
    }
  }
  out.set("src", POSTER_LANDING_SRC);
  const query = out.toString();
  return query ? `/near?${query}` : `/near?src=${POSTER_LANDING_SRC}`;
}

/** One honest orientation line for a scan that landed on /near. */
export function posterLandingOrientation(medium: PosterMedium = "poster"): string {
  return `You scanned ${POSTER_MEDIUM_NOUNS[medium]}. Listed pint prices near you are below.`;
}

export function rememberPosterLandingSession(medium: PosterMedium = "poster"): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(POSTER_LANDING_SESSION_KEY, medium);
  } catch {
    // Private mode / quota: orientation still works from the query flag.
  }
}

/** The medium this tab arrived from, or null. A tab from an older build holds "1", a poster. */
export function readPosterLandingMedium(): PosterMedium | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const stored = sessionStorage.getItem(POSTER_LANDING_SESSION_KEY);
    if (stored === "1") return "poster";
    return isPosterMedium(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function readPosterLandingSession(): boolean {
  return readPosterLandingMedium() !== null;
}

export function clearPosterLandingSession(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(POSTER_LANDING_SESSION_KEY);
  } catch {
    // Private mode / quota: nothing to clear.
  }
}

/**
 * Query or same-tab session bridge: the drinker arrived from a printed poster.
 * `src=poster` is authoritative; session only covers a same-arrival URL rewrite
 * that drops src before NearPageClient remounts. Organic /near visits clear the
 * session on mount so orientation does not stick for the whole tab.
 */
export function isPosterLandingArrival(
  src: string | null | undefined,
): boolean {
  return isPosterLandingSrc(src) || readPosterLandingSession();
}
