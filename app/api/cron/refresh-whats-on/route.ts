// GET /api/cron/refresh-whats-on — scheduled What's-On official-API refresh.
//
// Ticketmaster and Skiddle already run inside a function. This cron asks them
// for the Out window, drops expired rows, and writes kind=event to the durable
// whats_on_listings store (migration 0119). The read side prefers that store
// and falls back to the committed public/data/whats_on files. Harvested
// quiz/deal/music/sport scrapes stay out of this function: they need disk
// agents the serverless FS cannot run, and GitHub workflows remain for when
// Actions billing returns.
//
// A measured provider success stamps feed_freshness. No configured provider,
// or a fetch that failed, leaves the previous stamp and the previous store.
// AUTH: CRON_SECRET Bearer (lib/cronAuth).

import { jsonNoStore } from "@/lib/apiResponses";
import { assertCronRequest } from "@/lib/cronAuth";
import { feedFreshnessStore } from "@/lib/feedFreshnessStore";
import { WHATS_ON_FEED_KEY } from "@/lib/freshnessStoreOverlay";
import { refreshOfficialWhatsOnListings } from "@/lib/whatsOnRefresh.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const denied = assertCronRequest(request);
  if (denied) return denied;

  let result;
  try {
    result = await refreshOfficialWhatsOnListings();
  } catch (err) {
    const failure = err instanceof Error ? err.message : String(err);
    console.error("[cron:refresh-whats-on] official-API refresh failed:", failure);
    return jsonNoStore({
      ok: false,
      feed: WHATS_ON_FEED_KEY,
      mode: "providers",
      written: 0,
      observedAt: null,
      stamped: false,
      error: failure,
    });
  }

  if (!result.ok || result.observedAt === null) {
    console.warn(
      `[cron:refresh-whats-on] observedAt NOT advanced (${result.mode}): previous stamp and store stand.`,
    );
    return jsonNoStore({
      ok: false,
      feed: WHATS_ON_FEED_KEY,
      mode: result.mode,
      written: result.written,
      observedAt: null,
      stamped: false,
      providers: result.providers,
    });
  }

  const stamp = await feedFreshnessStore().stamp({
    feed: WHATS_ON_FEED_KEY,
    observedAt: result.observedAt,
    rowsServed: result.written,
    note: "official-API event persist (Ticketmaster / Skiddle -> whats_on_listings)",
  });

  console.log(
    `[cron:refresh-whats-on] persisted ${result.written} official-API rows at ${result.observedAt}${stamp.failed ? " (stamp write degraded)" : ""}.`,
  );
  return jsonNoStore({
    ok: true,
    feed: WHATS_ON_FEED_KEY,
    mode: result.mode,
    written: result.written,
    observedAt: result.observedAt,
    stamped: stamp.failed !== true,
    stampDegraded: stamp.failed ?? false,
    providers: result.providers,
  });
}
