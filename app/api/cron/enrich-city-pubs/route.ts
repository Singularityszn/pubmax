// GET /api/cron/enrich-city-pubs - bounded official-page discovery for UK city pubs.
//
// Local CLI runs own durable, reviewable repository output. Vercel functions
// cannot commit static files, so cron rotates one bounded batch through same
// tested enrichment core and emits structured observations to function logs.
// SEARCH_PROVIDER selects Exa or Tavily. CRON_SECRET protects invocation.
//
// SAFE TO FAIL, SAFE TO RETRY (2026-09-05). The run holds a durable checkpoint
// (`lib/cityEnrichmentCheckpoint.ts`, migration 0142) rather than deriving its
// start index from the calendar day. A venue whose search fails is recorded
// and owed a bounded retry, so the night's remaining budget still reaches the
// pubs behind it; a second scheduler finds the lease held and spends nothing;
// and a run that dies mid-batch still commits what it learned. The route
// publishes NOTHING: every price and page it reports goes to the function log,
// and the reviewed price lanes are untouched, so no repeat run can duplicate a
// published record.

import { sendAlert } from "@/lib/alertSink";
import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { assertCronRequest } from "@/lib/cronAuth";
import { createSearchProvider } from "@/lib/searchProvider.server";
import {
  DEFERRED_QUEUE_AGE_ALERT_MS,
  MAX_VENUE_ATTEMPTS,
  RETRY_QUERY_BUDGET,
  runScheduledCityEnrichment,
  SEARCH_CRON_QUERY_CAP,
  type ScheduledCityRunOutcome,
  type ScheduledEnrichmentProgress,
} from "@/lib/tavilyPubEnrichment.server";
import type { CityEnrichmentHealth } from "@/lib/cityEnrichmentCheckpoint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** The documented way back for a venue the attempt cap has refused. */
const TERMINAL_RETRY_PATH = 'POST /api/admin/city-enrichment { action: "requeue", city }';

function checkpointSummary(checkpoints: CityEnrichmentHealth[] | undefined) {
  return (checkpoints ?? []).map((health) => ({
    city: health.city,
    nextIndex: health.nextIndex,
    totalPubs: health.totalPubs,
    passes: health.passes,
    deferred: health.deferred,
    terminal: health.terminal,
    // How long the oldest owed retry has been owed. A deferral count alone
    // reads the same whether the queue drains nightly or has been stuck since
    // the first outage, and only the second is a fault.
    queueAgeMs: health.queueAgeMs,
    queueAgeAlert: health.queueAgeAlert,
  }));
}

/**
 * Everything the operator is owed about the retry queue, on EVERY exit.
 *
 * A CHECKPOINT THAT LANDED IN MEMORY is a retry queue that dies with the
 * function instance, so every deferral this route records is lost before the
 * next night reads it. The old body reported `checkpointDurable` from the
 * credentials, which are present whether or not migration 0142 was applied.
 *
 * A QUEUE THAT IS NOT DRAINING is the same fault seen from the other end: the
 * venues are recorded, and nothing is resolving them.
 */
function alertOnQueueHealth(result: {
  checkpointDurable?: boolean | null;
  checkpointExpectedDurable?: boolean;
  checkpoints?: CityEnrichmentHealth[];
}): void {
  if (result.checkpointExpectedDurable && result.checkpointDurable === false) {
    console.error(
      "[cron:enrich-city-pubs][city-enrichment][ALERT]",
      JSON.stringify({
        finding: "checkpoint-not-durable",
        detail:
          "Checkpoints were written to process memory. Every deferred venue is lost on the next cold start.",
        remedy: "apply migration 0142",
      }),
    );
    sendAlert({
      source: "city-enrichment-checkpoint",
      text: "Checkpoints were written to process memory, so every deferred venue is lost on the next cold start. Apply migration 0142.",
    });
  }

  // A venue the attempt cap has refused is an operator's decision to make, so
  // it says so once, by name, with the way back beside it. It belongs on BOTH
  // exits: the night a venue is refused for the third time is very often a
  // night the whole run refuses too, and this used to be logged only on the
  // success path, so exactly those refusals went unnamed.
  for (const health of (result.checkpoints ?? []).filter((entry) => entry.terminal > 0)) {
    console.error(
      "[cron:enrich-city-pubs][city-enrichment][terminal]",
      JSON.stringify({
        city: health.city,
        venuesRefused: health.venuesRefused,
        maxVenueAttempts: MAX_VENUE_ATTEMPTS,
        retryPath: TERMINAL_RETRY_PATH,
      }),
    );
  }

  const aged = (result.checkpoints ?? []).filter((health) => health.queueAgeAlert);
  if (aged.length > 0) {
    console.error(
      "[cron:enrich-city-pubs][city-enrichment][ALERT]",
      JSON.stringify({
        finding: "deferred-queue-not-draining",
        thresholdMs: DEFERRED_QUEUE_AGE_ALERT_MS,
        cities: aged.map((health) => ({
          city: health.city,
          queueAgeMs: health.queueAgeMs,
          oldestDeferredFirstFailedAt: health.oldestDeferredFirstFailedAt,
          deferred: health.deferred,
        })),
        retryPath: TERMINAL_RETRY_PATH,
      }),
    );
    sendAlert({
      source: "city-enrichment-queue",
      text: `The deferred queue is not draining for ${aged.map((health) => health.city).join(", ")}. Retry path: ${TERMINAL_RETRY_PATH}`,
    });
  }
}

export async function GET(request: Request): Promise<Response> {
  const denied = assertCronRequest(request);
  if (denied) return denied;

  const searchProvider = createSearchProvider();
  if (!searchProvider.configured) {
    console.warn(
      `[cron:enrich-city-pubs] ${searchProvider.name === "tavily" ? "TAVILY_API_KEY" : "AI Gateway API key or Vercel OIDC credentials, and TAVILY_API_KEY"} absent - enrichment skipped.`,
    );
    return jsonNoStore({
      ok: true,
      skipped: searchProvider.name === "tavily" ? "no-tavily-key" : "no-search-provider",
      queriesSpent: 0,
      creditsSpent: 0,
    });
  }

  let lastProgress: ScheduledEnrichmentProgress | null = null;
  let loggedPrices = 0;
  let loggedPages = 0;

  try {
    const result = await runScheduledCityEnrichment({
      searchProvider,
      onProgress: (progress) => {
        lastProgress = progress;
        const newPrices = progress.prices.slice(loggedPrices);
        const newPages = progress.pages.slice(loggedPages);
        loggedPrices = progress.prices.length;
        loggedPages = progress.pages.length;
        console.log(
          "[cron:enrich-city-pubs][city-enrichment][progress]",
          JSON.stringify({
            city: progress.city,
            nextIndex: progress.nextIndex,
            queriesSpent: progress.queriesSpent,
            creditsSpent: progress.creditsSpent,
            prices: newPrices,
            pages: newPages,
          }),
        );
      },
    });
    const providerStats = searchProvider.stats();
    console.log(
      "[cron:enrich-city-pubs][city-enrichment]",
      JSON.stringify({
        city: result.city,
        primaryCity: result.primaryCity,
        cityRuns: result.cityRuns,
        startIndex: result.startIndex,
        nextIndex: result.nextIndex,
        queriesSpent: result.queriesSpent,
        creditsSpent: result.creditsSpent,
        provider: providerStats.selectedProvider,
        gatewayCalls: providerStats.gatewayCalls,
        gatewayMaxCalls: providerStats.gatewayMaxCalls,
        gatewayModel: providerStats.model ?? null,
        estimatedTokens: providerStats.estimatedTokens,
        tavilyCalls: providerStats.tavilyCalls,
        matchedPubs: result.matchedPubs,
        checkpointDurable: result.checkpointDurable ?? null,
        checkpointExpectedDurable: result.checkpointExpectedDurable ?? false,
        checkpoints: checkpointSummary(result.checkpoints),
        prices: result.prices,
        pages: result.pages,
        delegatedChains: result.delegatedChains.map(({ pub, chain, harvester }) => ({
          osmId: pub.osmId,
          pubName: pub.name,
          chain,
          harvester,
        })),
      }),
    );

    alertOnQueueHealth(result);

    return jsonNoStore({
      ok: true,
      city: result.city,
      primaryCity: result.primaryCity,
      cityRuns: result.cityRuns,
      startIndex: result.startIndex,
      nextIndex: result.nextIndex,
      queryCap: SEARCH_CRON_QUERY_CAP,
      retryQueryBudget: RETRY_QUERY_BUDGET,
      maxVenueAttempts: MAX_VENUE_ATTEMPTS,
      provider: providerStats.selectedProvider,
      queriesSpent: result.queriesSpent,
      creditsSpent: result.creditsSpent,
      gatewayCalls: providerStats.gatewayCalls,
      gatewayMaxCalls: providerStats.gatewayMaxCalls,
      gatewayModel: providerStats.model ?? null,
      estimatedTokens: providerStats.estimatedTokens,
      tavilyCalls: providerStats.tavilyCalls,
      matchedPubs: result.matchedPubs,
      pricesExtracted: result.prices.length,
      chainPubsDelegated: result.delegatedChains.length,
      // Null is "no city wrote a checkpoint this run", which is not the same
      // answer as memory and may never be flattened into false.
      checkpointDurable: result.checkpointDurable ?? null,
      checkpointExpectedDurable: result.checkpointExpectedDurable ?? false,
      deferredQueueAgeAlertMs: DEFERRED_QUEUE_AGE_ALERT_MS,
      checkpoints: checkpointSummary(result.checkpoints),
      // This route publishes nothing. The figure is stated so a reader never
      // has to infer it from an absence.
      published: 0,
      terminalRetryPath: TERMINAL_RETRY_PATH,
    });
  } catch (error) {
    const providerStats = searchProvider.stats();
    console.error(
      "[cron:enrich-city-pubs][city-enrichment][ALERT] search enrichment failed:",
      error instanceof Error ? error.message : String(error),
    );
    console.error(
      "[cron:enrich-city-pubs][city-enrichment][spend]",
      JSON.stringify({
        provider: providerStats.selectedProvider,
        gatewayCalls: providerStats.gatewayCalls,
        gatewayMaxCalls: providerStats.gatewayMaxCalls,
        gatewayModel: providerStats.model ?? null,
        estimatedTokens: providerStats.estimatedTokens,
        tavilyCalls: providerStats.tavilyCalls,
      }),
    );
    const failure = error as Error & {
      cityRuns?: ScheduledCityRunOutcome[];
      checkpoints?: CityEnrichmentHealth[];
      checkpointDurable?: boolean | null;
      checkpointExpectedDurable?: boolean;
    };
    // The night the queue stops draining is exactly a night this route
    // refuses, so the queue-health alert belongs on the failure path most of
    // all. The checkpoint is committed before the refusal reaches here.
    alertOnQueueHealth(failure);
    const partial = lastProgress as ScheduledEnrichmentProgress | null;
    if (partial) {
      console.error(
        "[cron:enrich-city-pubs][city-enrichment][partial]",
        JSON.stringify({
          city: partial.city,
          nextIndex: partial.nextIndex,
          queriesSpent: partial.queriesSpent,
          creditsSpent: partial.creditsSpent,
          matchedPubs: partial.pages.length,
          pricesExtracted: partial.prices.length,
        }),
      );
    }
    // The checkpoint is committed before the refusal reaches here, so a failed
    // run still says where it got to and what it left owed.
    console.error(
      "[cron:enrich-city-pubs][city-enrichment][checkpoint]",
      JSON.stringify({
        cityRuns: failure.cityRuns ?? [],
        checkpoints: checkpointSummary(failure.checkpoints),
        retryPath: TERMINAL_RETRY_PATH,
      }),
    );
    return publicApiError("City enrichment provider unavailable.", "PROVIDER_UNAVAILABLE", 502, {
      retryable: true,
    });
  }
}
