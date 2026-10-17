import "server-only";

import type { SocialPubBand, SocialPubRankingRow } from "@/lib/socialPubRankings";
import { isMissingTableSchema, onMissingDurableWrite, selectStore } from "@/lib/storeBackend";
import { requireSupabaseAdmin, requiresSupabaseStore } from "@/lib/supabase";

type RankingActor = { profileId: string };

export class SocialPubRankingError extends Error {
  constructor(
    public readonly code: "STALE_RANKING" | "INVALID_RANKING",
    message: string,
  ) {
    super(message);
    this.name = "SocialPubRankingError";
  }
}

export type SocialPubRankingStore = {
  read(actor: RankingActor): Promise<SocialPubRankingRow[]>;
  /** Places (or moves) a pub between two neighbours that must be adjacent now. */
  place(actor: RankingActor, venueId: string, band: SocialPubBand, aboveVenueId: string | null, belowVenueId: string | null): Promise<void>;
  remove(actor: RankingActor, venueId: string): Promise<boolean>;
};

export function createMemorySocialPubRankingStore(options: { now?: () => Date } = {}): SocialPubRankingStore {
  const lists = new Map<string, Map<string, SocialPubRankingRow>>();
  const now = options.now ?? (() => new Date());
  const listFor = (actor: RankingActor) => {
    let list = lists.get(actor.profileId);
    if (!list) {
      list = new Map();
      lists.set(actor.profileId, list);
    }
    return list;
  };
  return {
    async read(actor) {
      return [...listFor(actor).values()].map((row) => ({ ...row }));
    },
    async place(actor, venueId, band, aboveVenueId, belowVenueId) {
      if (!venueId || venueId === aboveVenueId || venueId === belowVenueId) {
        throw new SocialPubRankingError("INVALID_RANKING", "That ranking is not valid.");
      }
      const list = listFor(actor);
      const previous = list.get(venueId);
      list.delete(venueId);
      const stale = () => {
        if (previous) list.set(venueId, previous);
        return new SocialPubRankingError("STALE_RANKING", "Your list changed. Compare again.");
      };
      const above = aboveVenueId ? list.get(aboveVenueId) : undefined;
      const below = belowVenueId ? list.get(belowVenueId) : undefined;
      if ((aboveVenueId && above?.band !== band) || (belowVenueId && below?.band !== band)) throw stale();
      const aboveKey = above?.rankKey ?? null;
      const belowKey = below?.rankKey ?? null;
      if (aboveKey !== null && belowKey !== null && aboveKey >= belowKey) throw stale();
      const between = [...list.values()].some((row) => row.band === band &&
        (aboveKey === null || row.rankKey > aboveKey) && (belowKey === null || row.rankKey < belowKey));
      if (between) throw stale();
      const rankKey = aboveKey === null && belowKey === null ? 1000
        : aboveKey === null ? belowKey! - 1000
          : belowKey === null ? aboveKey + 1000
            : (aboveKey + belowKey) / 2;
      list.set(venueId, { venueId, band, rankKey, updatedAt: now().toISOString() });
    },
    async remove(actor, venueId) {
      return listFor(actor).delete(venueId);
    },
  };
}

const memorySocialPubRankingStore = createMemorySocialPubRankingStore();

async function durableOrMemory<T>(operation: () => Promise<T>, fallback: () => Promise<T>, write: boolean): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isMissingTableSchema(error, ["social_pub_rankings"])) throw error;
    if (requiresSupabaseStore()) throw error;
    if (!write) return fallback();
    return onMissingDurableWrite({ storeTag: "social-pub-rankings", migrationHint: "apply migration 0185", fallback });
  }
}

const supabaseSocialPubRankingStore: SocialPubRankingStore = {
  async read(actor) {
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin().rpc("read_social_pub_rankings", { p_author_profile_id: actor.profileId });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        venueId: String(row.venue_id),
        band: row.band as SocialPubBand,
        rankKey: Number(row.rank_key),
        updatedAt: String(row.updated_at),
      }));
    }, () => memorySocialPubRankingStore.read(actor), false);
  },
  async place(actor, venueId, band, aboveVenueId, belowVenueId) {
    return durableOrMemory(async () => {
      const { error } = await requireSupabaseAdmin().rpc("place_social_pub_ranking", {
        p_author_profile_id: actor.profileId,
        p_venue_id: venueId,
        p_band: band,
        p_above_venue_id: aboveVenueId,
        p_below_venue_id: belowVenueId,
      });
      if (error) {
        if (/stale Social ranking/i.test(error.message)) throw new SocialPubRankingError("STALE_RANKING", "Your list changed. Compare again.");
        if (/invalid Social ranking/i.test(error.message)) throw new SocialPubRankingError("INVALID_RANKING", "That ranking is not valid.");
        throw error;
      }
    }, () => memorySocialPubRankingStore.place(actor, venueId, band, aboveVenueId, belowVenueId), true);
  },
  async remove(actor, venueId) {
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin().rpc("remove_social_pub_ranking", {
        p_author_profile_id: actor.profileId,
        p_venue_id: venueId,
      });
      if (error) throw error;
      return data === true;
    }, () => memorySocialPubRankingStore.remove(actor, venueId), true);
  },
};

export function socialPubRankingStore(): SocialPubRankingStore {
  return selectStore(memorySocialPubRankingStore, supabaseSocialPubRankingStore);
}
