import "server-only";

// Price trust impact: create first-cluster unlocks and read the owner's card.
//
// Trust itself lives in lib/communityPrice.ts. This module only reacts when a
// write-back or a hide changes that answer, and it never invents a second
// threshold. Fail-soft: a price write still lands if this sync cannot.

import {
  countCommunityPriceObservationsForActor,
  findCommunityPriceObservation,
  listCommunityPriceObservations,
  listCommunityPriceObservationsForPairs,
  type CommunityPriceObservation,
} from "@/lib/communityPriceStore";
import type { DrinkCategory } from "@/lib/drinks";
import { profileStore } from "@/lib/profileStore";
import { priceTrustEventStore } from "@/lib/priceTrustEventStore";
import {
  categoryIsTrusted,
  firstQualifyingCluster,
  profileIdFromActor,
  reversalFingerprint,
  trustEventFingerprint,
  type TrustObservation,
} from "@/lib/priceTrustEvents";

export type PriceTrustImpactReady = {
  status: "ready";
  observationsLogged: number;
  pricesTrustedNow: number;
  lifetimeTrustUnlocks: number;
};

export type PriceTrustImpact =
  | PriceTrustImpactReady
  | { status: "degraded" };

const STORE_TAG = "price-trust-events";

function pairKey(venueId: string, category: DrinkCategory): string {
  return `${venueId}\0${category}`;
}

function asTrustObservations(
  rows: readonly CommunityPriceObservation[],
): TrustObservation[] {
  return rows.map((row) => ({
    id: row.id,
    venueId: row.venueId,
    drinkCategory: row.drinkCategory,
    priceGbp: row.priceGbp,
    submittedAt: row.submittedAt,
    actor: row.actor,
    hidden: row.hidden,
  }));
}

async function userIdsForActors(actors: readonly string[]): Promise<string[]> {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const actor of actors) {
    const profileId = profileIdFromActor(actor);
    if (!profileId) continue;
    const profile = await profileStore().getById(profileId);
    const userId = profile?.userId?.trim();
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    ids.push(userId);
  }
  return ids;
}

async function recordFirstCluster(
  venueId: string,
  category: DrinkCategory,
  observations: readonly TrustObservation[],
  now: number,
  restorationKey?: string,
): Promise<void> {
  const cluster = firstQualifyingCluster(observations, now);
  if (!cluster) return;
  const userIds = await userIdsForActors(cluster.actors);
  if (cluster.actors.length > 0 && userIds.length === 0) return;
  const fingerprint = trustEventFingerprint(venueId, category, cluster.observationIds);
  await priceTrustEventStore().recordUnlock({
    // A previous unlock may have a hide reversal. Restoring the observation
    // needs a new positive event because the original fingerprint remains
    // append-only and cannot be reused as visible credit.
    fingerprint: restorationKey ? `restored:${fingerprint}:${restorationKey}` : fingerprint,
    venueId,
    category,
    observationIds: cluster.observationIds,
    userIds,
    now,
  });
}

export async function syncTrustAfterPriceWrite(
  venueId: string,
  category: DrinkCategory,
  now: number = Date.now(),
): Promise<void> {
  try {
    const listed = await listCommunityPriceObservations(venueId, category);
    if (listed.degraded) return;
    const observations = asTrustObservations(listed.observations);
    if (!categoryIsTrusted(observations, now)) return;
    const live = await priceTrustEventStore().liveEventsFor(venueId, category);
    if (live.degraded || live.events.length > 0) return;
    await recordFirstCluster(venueId, category, observations, now);
  } catch (error) {
    console.warn(`${STORE_TAG} sync after write failed`, error);
  }
}

export async function syncTrustAfterPriceHidden(
  observationId: string,
  now: number = Date.now(),
): Promise<void> {
  try {
    const found = await findCommunityPriceObservation(observationId);
    if (found.degraded || !found.observation) return;
    if (!found.observation.hidden) return;
    const { venueId, drinkCategory } = found.observation;
    const covering = await priceTrustEventStore().liveEventsCovering(observationId);
    if (covering.degraded) return;
    for (const event of covering.events) {
      const written = await priceTrustEventStore().recordUnlock({
        fingerprint: reversalFingerprint(event.evidenceFingerprint),
        venueId: event.venueId,
        category: event.category,
        observationIds: [],
        userIds: [],
        reversalOf: event.id,
        now,
      });
      if (written.failed || !written.event) {
        console.warn(
          `${STORE_TAG} reversal write failed; credit still visible for trust event ${event.id}`,
        );
        return;
      }
    }
    const listed = await listCommunityPriceObservations(venueId, drinkCategory);
    if (listed.degraded) return;
    const current = await findCommunityPriceObservation(observationId);
    if (current.degraded || !current.observation?.hidden) return;
    const observations = asTrustObservations(listed.observations);
    if (!categoryIsTrusted(observations, now)) return;
    const live = await priceTrustEventStore().liveEventsFor(venueId, drinkCategory);
    if (live.degraded || live.events.length > 0) return;
    await recordFirstCluster(venueId, drinkCategory, observations, now);
  } catch (error) {
    console.warn(`${STORE_TAG} sync after hide failed`, error);
  }
}

export async function syncTrustAfterPriceRestored(
  observationId: string,
  now: number = Date.now(),
): Promise<void> {
  try {
    const found = await findCommunityPriceObservation(observationId);
    if (found.degraded || !found.observation) return;
    if (found.observation.hidden) return;
    const { venueId, drinkCategory } = found.observation;
    const listed = await listCommunityPriceObservations(venueId, drinkCategory);
    if (listed.degraded) return;
    const observations = asTrustObservations(listed.observations);
    if (!categoryIsTrusted(observations, now)) return;
    const live = await priceTrustEventStore().liveEventsFor(venueId, drinkCategory);
    if (live.degraded || live.events.length > 0) return;
    // The row's moderation stamp identifies this transition. Include sync time
    // so two transitions that share a database timestamp still get distinct
    // append-only event identities. Route retries do not call this sync again
    // when moderation reports no state change.
    const restorationKey = `${found.observation.moderatedAt ?? now}:${now}`;
    const current = await findCommunityPriceObservation(observationId);
    if (current.degraded || current.observation?.hidden) return;
    await recordFirstCluster(venueId, drinkCategory, observations, now, restorationKey);
  } catch (error) {
    console.warn(`${STORE_TAG} sync after restore failed`, error);
  }
}

export async function readPriceTrustImpact(
  userId: string,
): Promise<PriceTrustImpact> {
  try {
    const key = userId.trim();
    if (!key) return { status: "degraded" };
    const profile = await profileStore().getByUserId(key);
    const actor = profile ? `profile:${profile.id}` : "";
    const logged = actor
      ? await countCommunityPriceObservationsForActor(actor)
      : { count: 0, degraded: false };
    if (logged.degraded) return { status: "degraded" };
    const impact = await priceTrustEventStore().readVisibleImpact(key);
    if (impact.degraded) return { status: "degraded" };

    const pairs = new Map<string, { venueId: string; category: DrinkCategory }>();
    for (const event of impact.events) {
      if (event.reversalOf) continue;
      pairs.set(pairKey(event.venueId, event.category), {
        venueId: event.venueId,
        category: event.category,
      });
    }
    const rows = await listCommunityPriceObservationsForPairs(
      [...pairs.values()].map((pair) => ({
        venueId: pair.venueId,
        drinkCategory: pair.category,
      })),
    );
    if (rows.degraded) return { status: "degraded" };
    const byPair = new Map<string, TrustObservation[]>();
    for (const observation of asTrustObservations(rows.observations)) {
      const pair = pairKey(observation.venueId, observation.drinkCategory);
      const held = byPair.get(pair);
      if (held) held.push(observation);
      else byPair.set(pair, [observation]);
    }
    let pricesTrustedNow = 0;
    for (const pair of pairs.keys()) {
      if (categoryIsTrusted(byPair.get(pair) ?? [])) pricesTrustedNow += 1;
    }

    return {
      status: "ready",
      observationsLogged: logged.count,
      pricesTrustedNow,
      lifetimeTrustUnlocks: impact.lifetimeTrustUnlocks,
    };
  } catch (error) {
    console.warn(`${STORE_TAG} impact read failed`, error);
    return { status: "degraded" };
  }
}
