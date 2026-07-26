// GET /api/cron/enrich-city-pubs - bounded Tavily discovery for UK city pubs.
//
// Local CLI runs own durable, reviewable repository output. Vercel functions
// cannot commit static files, so cron rotates one bounded batch through same
// tested enrichment core and emits structured observations to function logs.
// TAVILY_API_KEY absent means honest no-op. CRON_SECRET protects invocation.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { assertCronRequest } from "@/lib/cronAuth";
import {
  runScheduledCityEnrichment,
  TAVILY_CRON_QUERY_CAP,
} from "@/lib/tavilyPubEnrichment.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request): Promise<Response> {
  const denied = assertCronRequest(request);
  if (denied) return denied;

  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) {
    console.warn("[cron:enrich-city-pubs] TAVILY_API_KEY absent - enrichment skipped.");
    return jsonNoStore({
      ok: true,
      skipped: "no-tavily-key",
      queriesSpent: 0,
      creditsSpent: 0,
    });
  }

  try {
    const result = await runScheduledCityEnrichment({ apiKey });
    console.log(
      "[cron:enrich-city-pubs][city-enrichment]",
      JSON.stringify({
        city: result.city,
        startIndex: result.startIndex,
        nextIndex: result.nextIndex,
        queriesSpent: result.queriesSpent,
        creditsSpent: result.creditsSpent,
        matchedPubs: result.matchedPubs,
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
    return jsonNoStore({
      ok: true,
      city: result.city,
      startIndex: result.startIndex,
      nextIndex: result.nextIndex,
      queryCap: TAVILY_CRON_QUERY_CAP,
      queriesSpent: result.queriesSpent,
      creditsSpent: result.creditsSpent,
      matchedPubs: result.matchedPubs,
      pricesExtracted: result.prices.length,
      chainPubsDelegated: result.delegatedChains.length,
    });
  } catch (error) {
    console.error(
      "[cron:enrich-city-pubs][city-enrichment][ALERT] Tavily enrichment failed:",
      error instanceof Error ? error.message : String(error),
    );
    return publicApiError("City enrichment provider unavailable.", "PROVIDER_UNAVAILABLE", 502, {
      retryable: true,
    });
  }
}
