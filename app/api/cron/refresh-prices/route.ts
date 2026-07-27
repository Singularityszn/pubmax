// GET /api/cron/refresh-prices - scheduled permissible-source price sweep.
//
// This route moves source collection onto existing Vercel cron plane. Source
// parsers are currently stubbed, so production behavior is an explicit safe
// no-op: no rows means no freshness stamp. A future parser can return validated,
// provenance-stamped rows through lib/priceRefresh.server.ts without changing
// scheduler wiring.
//
// HONEST SCOPE: serverless deployment cannot update committed price snapshot or
// open human-review PR. Freshness records successful source retrieval only, and
// never advances after empty, invalid, or failed collection.
//
// AUTH: CRON_SECRET Bearer via shared lib/cronAuth.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { assertCronRequest } from "@/lib/cronAuth";
import { feedFreshnessStore } from "@/lib/feedFreshnessStore";
import { PRICE_UPDATES_FEED_KEY } from "@/lib/freshnessStoreOverlay";
import { fetchPriceUpdates } from "@/lib/priceRefresh.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const denied = assertCronRequest(request);
  if (denied) return denied;

  let result;
  try {
    result = await fetchPriceUpdates();
  } catch (err) {
    console.error(
      "[cron:refresh-prices][price-updates][ALERT] source collection failed:",
      err instanceof Error ? err.message : String(err),
    );
    return publicApiError(
      "Price source unavailable.",
      "PROVIDER_UNAVAILABLE",
      502,
      { retryable: true },
    );
  }

  if (
    result.sourcesChecked > 0 &&
    result.failedSources.length === result.sourcesChecked
  ) {
    console.error(
      "[cron:refresh-prices][price-updates][ALERT] every configured source failed:",
      result.failedSources,
    );
    return publicApiError(
      "Price sources unavailable.",
      "PROVIDER_UNAVAILABLE",
      502,
      { retryable: true },
    );
  }

  if (result.failedSources.length > 0) {
    console.warn(
      "[cron:refresh-prices] partial source failure:",
      result.failedSources,
    );
  }

  if (result.updates.length === 0) {
    const reason =
      result.fetchedRows === 0
        ? "fetched no rows"
        : `fetched ${result.fetchedRows} row(s), but none passed validation`;
    console.warn(
      `[cron:refresh-prices] ${reason}; freshness unchanged.`,
    );
    return jsonNoStore({
      ok: true,
      feed: PRICE_UPDATES_FEED_KEY,
      fetchedRows: result.fetchedRows,
      droppedRows: result.droppedRows,
      sourcesChecked: result.sourcesChecked,
      failedSources: result.failedSources.map(({ id }) => id),
      retrievedRows: 0,
      freshnessAdvanced: false,
    });
  }

  const observedAt = result.updates.reduce(
    (latest, update) =>
      Date.parse(update.observedAt) > Date.parse(latest)
        ? update.observedAt
        : latest,
    result.updates[0].observedAt,
  );
  const outcome = await feedFreshnessStore().stamp({
    feed: PRICE_UPDATES_FEED_KEY,
    observedAt,
    rowsServed: result.updates.length,
    note: `${result.updates.length} valid permissible-source row(s) retrieved`,
  });

  if (outcome.failed) {
    console.error(
      "[cron:refresh-prices][price-updates][ALERT] freshness stamp failed after successful collection.",
    );
    return publicApiError(
      "Price freshness store unavailable.",
      "STORE_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }

  console.log(
    `[cron:refresh-prices] retrieved ${result.updates.length} valid row(s), observed at ${observedAt}.`,
  );
  return jsonNoStore({
    ok: true,
    feed: PRICE_UPDATES_FEED_KEY,
    observedAt,
    fetchedRows: result.fetchedRows,
    droppedRows: result.droppedRows,
    sourcesChecked: result.sourcesChecked,
    failedSources: result.failedSources.map(({ id }) => id),
    retrievedRows: result.updates.length,
    freshnessAdvanced: true,
  });
}
