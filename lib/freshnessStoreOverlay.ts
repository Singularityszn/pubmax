// Store-backed honest-observedAt overlay for the freshness spine.
//
// The freshness registry resolves each dataset's stamp from its committed disk
// artifact. But two feeds are now refreshed by the Vercel cron plane into a
// DURABLE store (not a committed file, which is read-only on serverless): the
// weather snapshot and the What's-On tonight window. For those, the disk file's
// generatedAt is frozen at the last commit and would lie about freshness. This
// overlay returns the store's real observedAt for those feeds so /api/freshness
// and the freshness-audit cron report the truth.
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

  return overlay;
}
