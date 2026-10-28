// Follow a harvest redirect chain BY HAND, and ask permission about each hop
// BEFORE the request for it is sent.
//
// WHY THIS EXISTS. `redirect: "follow"` sends a request to every hop the host
// names and only then hands back the last one. A landing check after the fetch
// can refuse to READ that page, but it cannot take the request back: the
// request to a refused estate, to our own network or to a robots-disallowed
// path has already gone. Here each `Location` is resolved and put to the lane's
// own permission question first, and a refusal means the next request is never
// made. The lanes still re-ask `harvestRedirectLanding` about the final
// response, as a second fence.
//
// A plain-node CLI imports this module, so it imports nothing.

/** A chain may never become a crawl. Five hops covers www, https and a slash. */
export const HARVEST_REDIRECT_HOP_LIMIT = 5;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** The lane's answer about one hop. A robots decision already has this shape. */
type RedirectHopVerdict = { allowed: boolean; reason?: string; evidence?: string };

type RedirectRefusal = { url: string; status: number; reason: string; evidence: string };

type PermittedRedirectResult =
  | { refusal: null; response: Response; url: string }
  | { refusal: RedirectRefusal; response: null; url: string };

function discardBody(response: Response): void {
  void response.body?.cancel().catch(() => {});
}

/**
 * Fetch `url` and follow at most `HARVEST_REDIRECT_HOP_LIMIT` redirects, calling
 * `permitHop` with each resolved target before it is requested.
 *
 * The caller has already asked permission about `url` itself. A 3xx with no
 * `Location` is an ordinary answer and is returned as the response. `url` in
 * the result is the last URL that was requested, or the target that was
 * refused.
 */
export async function fetchFollowingPermittedRedirects(
  url: string,
  init: RequestInit,
  {
    fetchImpl = fetch,
    permitHop,
  }: {
    fetchImpl?: typeof fetch;
    permitHop: (next: string, from: string) => Promise<RedirectHopVerdict>;
  },
): Promise<PermittedRedirectResult> {
  let current = url;
  for (let hops = 0; ; hops += 1) {
    const response = await fetchImpl(current, { ...init, redirect: "manual" });
    const location = REDIRECT_STATUSES.has(response.status) ? response.headers.get("location") : null;
    if (!location) return { refusal: null, response, url: current };
    discardBody(response);

    let next: string;
    try {
      next = new URL(location, current).href;
    } catch {
      return {
        refusal: {
          url: current,
          status: response.status,
          reason: "redirect-unreadable",
          evidence: `${current} answered ${response.status} with a Location that is not a URL.`,
        },
        response: null,
        url: current,
      };
    }
    if (hops >= HARVEST_REDIRECT_HOP_LIMIT) {
      return {
        refusal: {
          url: next,
          status: response.status,
          reason: "redirect-hop-limit",
          evidence: `${url} redirected more than ${HARVEST_REDIRECT_HOP_LIMIT} times, so ${next} was not requested.`,
        },
        response: null,
        url: next,
      };
    }
    const verdict = await permitHop(next, current);
    if (!verdict.allowed) {
      return {
        refusal: {
          url: next,
          status: response.status,
          reason: verdict.reason ?? "redirect-refused",
          evidence: verdict.evidence ?? `${current} redirected to ${next}, which is not permitted.`,
        },
        response: null,
        url: next,
      };
    }
    current = next;
  }
}
