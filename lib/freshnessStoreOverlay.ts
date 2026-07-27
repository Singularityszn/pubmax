// Store-backed honest-observedAt overlay for the freshness spine.
//
// The freshness registry resolves each dataset's stamp from its committed disk
// artifact. Some feeds are refreshed by the Vercel cron plane into a
// DURABLE store (not a committed file, which is read-only on serverless).
// For those feeds, the disk timestamp can freeze at the last commit. This
// overlay returns store-observed time so /api/freshness and freshness audit
// report the truth.
//
// Fail-soft and env-gated: when no durable store is configured (local/test) or a
// store read fails, the feed is simply absent from the overlay and the caller
// keeps the disk-derived stamp — behaviour-identical to before this plane.

import { feedFreshnessStore } from "@/lib/feedFreshnessStore";
import { weatherSnapshotStore } from "@/lib/weatherSnapshotStore";

// Registry dataset id → the store that holds its honest observedAt.
export const WHATS_ON_FEED_KEY = "whats_on";
export const WEATHER_DATASET_ID = "weather";
export const WHATS_ON_DATASET_ID = "whats_on";
export const PRICE_UPDATES_FEED_KEY = "price_updates";
export const PRICE_UPDATES_DATASET_ID = "price_updates";
// Night Signal candidate ingestion (the Vercel-cron EXA sweep). This is the
// PENDING-candidate feed, distinct from the human-reviewed `night_signals`
// snapshot — it reports when ingestion last ran, never that claims were shipped.
export const NIGHT_SIGNAL_CANDIDATES_FEED_KEY = "night_signal_candidates";
export const NIGHT_SIGNAL_CANDIDATES_DATASET_ID = "night_signal_candidates";

/**
 * Resolve store-backed observedAt for the cron-plane feeds. Returns a map of
 * registry dataset id → ISO observedAt for every feed the store can answer for.
 * NEVER throws; a store miss/failure just omits that id.
 */
export async function resolveStoreObservedAt(): Promise<Record<string, string>> {
  const overlay: Record<string, string> = {};

  try {
    const snapshot = await weatherSnapshotStore().readSnapshot();
    if (snapshot?.generatedAt) overlay[WEATHER_DATASET_ID] = snapshot.generatedAt;
  } catch {
    // fail-soft: keep the disk stamp
  }

  try {
    const stamp = await feedFreshnessStore().read(WHATS_ON_FEED_KEY);
    if (stamp?.observedAt) overlay[WHATS_ON_DATASET_ID] = stamp.observedAt;
  } catch {
    // fail-soft: keep the disk stamp
  }

  try {
    const stamp = await feedFreshnessStore().read(PRICE_UPDATES_FEED_KEY);
    if (stamp?.observedAt) overlay[PRICE_UPDATES_DATASET_ID] = stamp.observedAt;
  } catch {
    // fail-soft: keep the disk stamp
  }

  try {
    const stamp = await feedFreshnessStore().read(NIGHT_SIGNAL_CANDIDATES_FEED_KEY);
    if (stamp?.observedAt) overlay[NIGHT_SIGNAL_CANDIDATES_DATASET_ID] = stamp.observedAt;
  } catch {
    // fail-soft: keep the disk stamp
  }

  return overlay;
}
