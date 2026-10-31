// The one door a small crawl CLI fetches through: a source-policy row, the
// permission fence and a live robots answer, asked in that order and before
// every request.
//
// WHY THIS EXISTS. Three CLIs (scripts/refresh_drink_prices.mjs,
// scripts/whatson/quizRefresh.mjs and scripts/whatson/scrape_greene_king_sport.mjs)
// each carried their own robots reader, and each failed OPEN: a 401, a 403, a
// challenge page or a network error on /robots.txt was read as "no rules, go
// ahead", only the `*` group was read, and none of them asked
// lib/harvest/sourcePolicy.ts at all. The project's own reading is in
// lib/harvest/robots.ts (a 404 publishes no restriction; a 401, 403, 429, 5xx
// or challenge page is a refusal), and the repo law is that a source not in
// the table is not harvested. This module holds both, so a caller cannot ask
// one without the other.
//
// WHAT A CALLER MAY NOT DO is hand this a URL of its own: the host a fetch is
// pinned to comes from the policy row, and every URL (including the page a
// redirect points at) must sit on that host and pass `isHarvestableOperatorUrl`.

// A plain-node CLI imports this module, so the specifiers are RELATIVE and
// carry their extensions.
import { fetchFollowingPermittedRedirects } from "../../lib/harvest/redirectChain.ts";
import { createRobotsChecker } from "../../lib/harvest/robots.ts";
import {
  harvestSource,
  isHarvestableOperatorUrl,
  normalizeHarvestHostname,
} from "../../lib/harvest/sourcePolicy.ts";

/** A recorded decision not to fetch. Never retried, never read as an outage. */
export class HarvestRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = "HarvestRefusal";
  }
}

/**
 * Whether the source-policy table permits `sourceId` this run.
 *
 * A missing row is a refusal, not a default: the table is the list of what may
 * be read, and adding a row is the captain's decision.
 */
export function permittedHarvestSource(sourceId) {
  const source = harvestSource(sourceId);
  if (!source) {
    return {
      allowed: false,
      source: null,
      message:
        `REFUSED ${sourceId}: lib/harvest/sourcePolicy.ts has no row for this source, ` +
        "so nothing is fetched. Adding a row is the captain's call.",
    };
  }
  if (!source.access.allowed) {
    return {
      allowed: false,
      source,
      message:
        `REFUSED ${sourceId}: lib/harvest/sourcePolicy.ts refuses it ` +
        `(${source.access.reason}, checked ${source.access.checkedOn}), so nothing is fetched.`,
    };
  }
  return { allowed: true, source, message: `${sourceId}: permitted by lib/harvest/sourcePolicy.ts.` };
}

function bareHost(url) {
  try {
    return normalizeHarvestHostname(new URL(url).hostname)?.replace(/^www\./, "") ?? null;
  } catch {
    return null;
  }
}

/** True when `url` passes the permission fence AND sits on the row's own host. */
export function isOnPermittedSourceHost(source, url) {
  const host = bareHost(source.url);
  return Boolean(host) && isHarvestableOperatorUrl(url) && bareHost(url) === host;
}

/**
 * Build a fetch bound to one ALLOWED policy row.
 *
 * Every call: the URL must be on the row's host and pass the fence, and the
 * host's robots.txt must permit the path. See `createRobotsChecker` for the
 * cache contract. Redirects are followed by hand, and each `Location` is put
 * to the same two questions BEFORE it is requested, so a refused hop is never
 * sent. A failure of any of them throws `HarvestRefusal`.
 */
export function createPermittedFetch({ source, fetchImpl = fetch, robots } = {}) {
  if (!source?.access?.allowed) {
    throw new HarvestRefusal(`REFUSED ${source?.id ?? "unknown source"}: no allowed source-policy row.`);
  }
  const checkRobots = robots ?? createRobotsChecker({ fetchImpl });

  async function assertPermitted(url) {
    if (!isOnPermittedSourceHost(source, url)) {
      throw new HarvestRefusal(
        `REFUSED ${url}: not on ${source.id}'s own host, or refused by lib/harvest/sourcePolicy.ts.`,
      );
    }
    const verdict = await checkRobots(url);
    if (!verdict.allowed) throw new HarvestRefusal(`REFUSED ${url}: ${verdict.evidence}`);
  }

  async function permittedFetch(url, init = {}) {
    await assertPermitted(url);
    const followed = await fetchFollowingPermittedRedirects(url, init, {
      fetchImpl,
      permitHop: async (next) => {
        await assertPermitted(next);
        return { allowed: true };
      },
    });
    if (followed.refusal) {
      throw new HarvestRefusal(`REFUSED ${followed.refusal.url}: ${followed.refusal.evidence}`);
    }
    const { response } = followed;
    // The final response is asked again, as a second fence: a fetch that
    // reports a landing other than the URL we requested is not trusted.
    const landed = typeof response.url === "string" && response.url ? response.url : followed.url;
    if (landed !== followed.url) {
      try {
        await assertPermitted(landed);
      } catch (error) {
        void response.body?.cancel().catch(() => {});
        throw error;
      }
    }
    return response;
  }

  permittedFetch.assertPermitted = assertPermitted;
  return permittedFetch;
}
