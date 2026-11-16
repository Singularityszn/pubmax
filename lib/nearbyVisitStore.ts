import "server-only";

import type { NearbyVisit } from "@/lib/nearbyVisit";
import { admin, selectStore } from "@/lib/storeBackend";

type NearbyVisitStore = {
  record(userId: string, venueId: string): Promise<void>;
  list(userId: string): Promise<NearbyVisit[]>;
};

const memory = new Map<string, Map<string, string>>();
const memoryStore: NearbyVisitStore = {
  async record(userId, venueId) {
    const visits = memory.get(userId) ?? new Map<string, string>();
    if (!visits.has(venueId)) visits.set(venueId, new Date().toISOString());
    memory.set(userId, visits);
  },
  async list(userId) {
    return [...(memory.get(userId) ?? [])].map(([venueId, checkedAt]) => ({ venueId, checkedAt }));
  },
};

const durableStore: NearbyVisitStore = {
  async record(userId, venueId) {
    const { error } = await admin().from("nearby_visits").upsert(
      { user_id: userId, venue_id: venueId },
      { onConflict: "user_id,venue_id", ignoreDuplicates: true },
    );
    if (error) throw new Error(error.message);
  },
  async list(userId) {
    const visits: NearbyVisit[] = [];
    let after = "";
    for (;;) {
      const query = admin().from("nearby_visits").select("venue_id,checked_at")
        .eq("user_id", userId).order("venue_id").limit(200);
      const { data, error } = await (after ? query.gt("venue_id", after) : query);
      if (error) throw new Error(error.message);
      for (const row of data ?? []) visits.push({ venueId: row.venue_id, checkedAt: row.checked_at });
      if (!data || data.length < 200) return visits;
      after = data[data.length - 1]!.venue_id;
    }
  },
};

export function nearbyVisitStore(): NearbyVisitStore {
  return selectStore(memoryStore, durableStore);
}

export function resetNearbyVisitsForTests(): void {
  memory.clear();
}
