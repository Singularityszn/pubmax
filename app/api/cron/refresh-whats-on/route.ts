// GET /api/cron/refresh-whats-on — scheduled What's-On freshness job (SLIM).
//
// HONEST SCOPE. The FULL What's-On ingest cannot run inside a serverless cron:
//   • the baseline verticals (sport/quiz/deals/music) are aggregated by
//     scripts/refresh_whats_on.mjs FROM pre-scraped agent outputs on disk — there
//     is no scraper in a Vercel function, and the output would be a committed
//     file the read-only serverless FS cannot write;
//   • the events vertical (scripts/whatson/eventsRefresh.mjs) needs provider keys
//     (TICKETMASTER_API_KEY / SKIDDLE_API_KEY) AND likewise writes a committed
//     file it cannot persist here.
// So this cron does the SLIM, honest thing it CAN do in a function: it
// revalidates the servable "tonight" window (baseline blended with live CityMCP
// at request time — the same path the app serves) and records a durable freshness
// stamp so /api/freshness reports an honest observedAt instead of the frozen
// generatedAt of the committed baseline file. Full-ingest alternatives are in
// docs/CRON_PLANE_RUNBOOK.md.
//
// KEYS degrade loud-but-soft: absent ingest/provider keys are logged and the full
// ingest is skipped — never faked. AUTH: CRON_SECRET Bearer (lib/cronAuth).

import { jsonNoStore } from "@/lib/apiResponses";
import { assertCronRequest } from "@/lib/cronAuth";
import { feedFreshnessStore } from "@/lib/feedFreshnessStore";
import { WHATS_ON_FEED_KEY } from "@/lib/freshnessStoreOverlay";
import { loadWhatsOn } from "@/lib/whatsOnStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Which env keys unlock which slice of a FULL ingest. Presence is logged so the
// owner can see, in the cron logs, exactly what a real refresh would light up.
const INGEST_KEYS = ["EXA_API_KEY", "FIRECRAWL_API_KEY"] as const;
const EVENT_PROVIDER_KEYS = ["TICKETMASTER_API_KEY", "SKIDDLE_API_KEY"] as const;

function presentKeys(names: readonly string[]): string[] {
  return names.filter((name) => Boolean(process.env[name]));
}

export async function GET(request: Request): Promise<Response> {
  const denied = assertCronRequest(request);
  if (denied) return denied;

  const ingestKeys = presentKeys(INGEST_KEYS);
  const eventKeys = presentKeys(EVENT_PROVIDER_KEYS);
  const missingIngest = INGEST_KEYS.filter((k) => !ingestKeys.includes(k));
  const missingEvents = EVENT_PROVIDER_KEYS.filter((k) => !eventKeys.includes(k));
  if (missingIngest.length || missingEvents.length) {
    console.warn(
      `[cron:refresh-whats-on] full ingest not performed (serverless-bound). ` +
        `Absent ingest keys: [${missingIngest.join(", ") || "none"}]; ` +
        `absent event-provider keys: [${missingEvents.join(", ") || "none"}]. ` +
        `Slim tonight-window revalidation only: see docs/CRON_PLANE_RUNBOOK.md.`,
    );
  }

  // Revalidate the servable window (fail-soft to baseline inside loadWhatsOn).
  let rows = 0;
  let asOf: string | null = null;
  let failure: string | null = null;
  try {
    const result = await loadWhatsOn({ window: "tonight" });
    if (result.readStatus === "ready" && result.revalidation.status === "measured") {
      rows = result.rows.length;
      asOf = result.asOf;
    } else if (result.readStatus === "degraded") {
      failure = "Could not check tonight listings.";
    } else if (result.revalidation.status === "unmeasured") {
      failure = result.revalidation.reason;
    }
    if (failure !== null) console.error("[cron:refresh-whats-on] tonight-window revalidation failed:", failure);
    else console.log("[cron:refresh-whats-on] tonight-window revalidation ready.");
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
    console.error("[cron:refresh-whats-on] tonight-window revalidation failed:", failure);
  }

  if (asOf === null) {
    console.warn(
      "[cron:refresh-whats-on] observedAt NOT advanced: the revalidation failed, so the previous stamp stands.",
    );
    return jsonNoStore({
      ok: false,
      feed: WHATS_ON_FEED_KEY,
      mode: "slim",
      observedAt: null,
      rowsServed: 0,
      stamped: false,
      stampDegraded: false,
      error: failure ?? "tonight-window revalidation failed",
      ingestKeysPresent: ingestKeys,
      eventProviderKeysPresent: eventKeys,
    });
  }

  const stamp = await feedFreshnessStore().stamp({
    feed: WHATS_ON_FEED_KEY,
    observedAt: asOf,
    rowsServed: rows,
    note: "slim tonight-window revalidation (full ingest is out-of-function; see runbook)",
  });

  console.log(`[cron:refresh-whats-on] revalidated tonight window: ${rows} rows at ${asOf}${stamp.failed ? " (stamp write degraded)" : ""}.`);
  return jsonNoStore({
    ok: true,
    feed: WHATS_ON_FEED_KEY,
    mode: "slim",
    observedAt: asOf,
    rowsServed: rows,
    stamped: stamp.failed !== true,
    stampDegraded: stamp.failed ?? false,
    ingestKeysPresent: ingestKeys,
    eventProviderKeysPresent: eventKeys,
  });
}
