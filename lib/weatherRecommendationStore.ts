// Dual-backend store for authored weather Recommendations.
//
// Public rows carry a contributor handle because attribution is part of the
// opinion. The server-derived actor hash is a separate private field used for
// abuse controls and audit provenance. It never crosses this module's public
// projection. One contributor owns one row per venue and weather condition, so
// editing a reason cannot inflate future leaderboard counts.

import { randomUUID } from "node:crypto";

import { isDeployedProduction } from "@/lib/deploymentEnv";
import {
  createFailSoftGuard,
  onMissingDurableWrite,
  selectStore,
} from "@/lib/storeBackend";
import { requireSupabaseAdmin } from "@/lib/supabase";
import {
  validateWeatherRecommendation,
  type WeatherRecommendation,
  type WeatherRecommendationInput,
} from "@/lib/weatherRecommendations";
import { normalizeHandle } from "@/lib/profiles";

const TABLE = "weather_recommendations";

export const MAX_WEATHER_RECOMMENDATIONS_PER_VENUE = 20;

export type WeatherRecommendationWrite = WeatherRecommendationInput & {
  actorHash?: string | null;
};

export type WeatherRecommendationReadResult = {
  status: "ready" | "degraded";
  recommendations: WeatherRecommendation[];
};

export type WeatherRecommendationContributorCountResult = {
  status: "ready" | "degraded";
  count: number;
};

export type WeatherRecommendationStore = {
  create(
    input: WeatherRecommendationWrite,
    now?: number,
  ): Promise<WeatherRecommendation>;
  listForVenue(venueId: string): Promise<WeatherRecommendationReadResult>;
  countForContributor(
    contributorHandle: string,
  ): Promise<WeatherRecommendationContributorCountResult>;
};

type StoredWeatherRecommendation = WeatherRecommendation & {
  actorHash: string | null;
};

type NormalizedWeatherRecommendationWrite = WeatherRecommendationInput & {
  actorHash: string | null;
};

function naturalKey(
  row: Pick<
    WeatherRecommendationInput,
    "venueId" | "condition" | "contributorHandle"
  >,
): string {
  return `${row.venueId}::${row.condition}::${row.contributorHandle}`;
}

function validWrite(
  input: WeatherRecommendationWrite,
): NormalizedWeatherRecommendationWrite {
  const validation = validateWeatherRecommendation(input);
  const actorHash =
    typeof input.actorHash === "string" ? input.actorHash.trim().slice(0, 160) : "";
  if (!validation.ok) throw new Error(validation.error);
  return { ...validation.value, actorHash: actorHash || null };
}

function published(
  row: StoredWeatherRecommendation,
): WeatherRecommendation {
  return {
    id: row.id,
    venueId: row.venueId,
    condition: row.condition,
    reason: row.reason,
    contributorHandle: row.contributorHandle,
    submittedAt: row.submittedAt,
    source: "community",
  };
}

// Process-level memory store for keyless development and tests.
const memoryRows = new Map<string, StoredWeatherRecommendation>();
const memoryIdsByNaturalKey = new Map<string, string>();

export const memoryWeatherRecommendationStore: WeatherRecommendationStore = {
  async create(raw, now = Date.now()) {
    const input = validWrite(raw);
    const key = naturalKey(input);
    const id = memoryIdsByNaturalKey.get(key) ?? randomUUID();
    const row: StoredWeatherRecommendation = {
      id,
      venueId: input.venueId,
      condition: input.condition,
      reason: input.reason,
      contributorHandle: input.contributorHandle,
      actorHash: input.actorHash,
      submittedAt: now,
      source: "community",
    };
    memoryRows.set(id, row);
    memoryIdsByNaturalKey.set(key, id);
    return published(row);
  },

  async listForVenue(venueId) {
    const recommendations = [...memoryRows.values()]
      .filter((row) => row.venueId === venueId)
      .sort((left, right) => right.submittedAt - left.submittedAt)
      .slice(0, MAX_WEATHER_RECOMMENDATIONS_PER_VENUE)
      .map(published);
    return { status: "ready", recommendations };
  },

  async countForContributor(contributorHandle) {
    const handle = normalizeHandle(contributorHandle);
    if (!handle) return { status: "ready", count: 0 };
    const count = [...memoryRows.values()].filter(
      (row) => row.contributorHandle === handle,
    ).length;
    return { status: "ready", count };
  },
};

type WeatherRecommendationRow = {
  id: unknown;
  venue_id: unknown;
  condition: unknown;
  reason: unknown;
  contributor_handle: unknown;
  submitted_at: unknown;
};

function fromRow(row: WeatherRecommendationRow): WeatherRecommendation | null {
  const validation = validateWeatherRecommendation({
    venueId: row.venue_id,
    condition: row.condition,
    reason: row.reason,
    contributorHandle: row.contributor_handle,
  });
  const id = typeof row.id === "string" ? row.id : "";
  const submittedAt =
    typeof row.submitted_at === "string" ? Date.parse(row.submitted_at) : Number.NaN;
  if (!validation.ok || !id || !Number.isFinite(submittedAt)) return null;
  return {
    id,
    ...validation.value,
    submittedAt,
    source: "community",
  };
}

const { guard, resetWarnings } = createFailSoftGuard({
  tag: "weather-recommendations",
  tables: TABLE,
  migrationHint: "apply migration 0058",
});

function degradedRead(): WeatherRecommendationReadResult {
  return { status: "degraded", recommendations: [] };
}

function degradedCount(): WeatherRecommendationContributorCountResult {
  return { status: "degraded", count: 0 };
}

export const supabaseWeatherRecommendationStore: WeatherRecommendationStore = {
  async create(raw, now = Date.now()) {
    const input = validWrite(raw);
    const submittedAt = new Date(now).toISOString();
    return guard<WeatherRecommendation>({
      context: "create",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "weather-recommendations",
          migrationHint: "apply migration 0058",
          fallback: () => memoryWeatherRecommendationStore.create(input, now),
        }),
      run: async () => {
        const { data, error } = await requireSupabaseAdmin()
          .from(TABLE)
          .upsert(
            {
              venue_id: input.venueId,
              condition: input.condition,
              reason: input.reason,
              contributor_handle: input.contributorHandle,
              actor_hash: input.actorHash,
              submitted_at: submittedAt,
            },
            { onConflict: "venue_id,condition,contributor_handle" },
          )
          .select(
            "id, venue_id, condition, reason, contributor_handle, submitted_at",
          )
          .single();
        if (error) throw new Error(error.message);
        const recommendation = fromRow(data as WeatherRecommendationRow);
        if (!recommendation) {
          throw new Error("Weather recommendation store returned an invalid row.");
        }
        return recommendation;
      },
    });
  },

  async listForVenue(venueId) {
    return guard<WeatherRecommendationReadResult>({
      context: "listForVenue",
      onSchemaMiss: () =>
        isDeployedProduction()
          ? Promise.resolve(degradedRead())
          : memoryWeatherRecommendationStore.listForVenue(venueId),
      message: "listForVenue failed, returning a degraded read",
      onError: degradedRead,
      run: async () => {
        const { data, error } = await requireSupabaseAdmin()
          .from(TABLE)
          .select(
            "id, venue_id, condition, reason, contributor_handle, submitted_at",
          )
          .eq("venue_id", venueId)
          .order("submitted_at", { ascending: false })
          .limit(MAX_WEATHER_RECOMMENDATIONS_PER_VENUE);
        if (error) throw new Error(error.message);
        const recommendations = ((data ?? []) as WeatherRecommendationRow[])
          .map(fromRow)
          .filter(
            (row): row is WeatherRecommendation => row !== null,
          );
        return { status: "ready", recommendations };
      },
    });
  },

  async countForContributor(contributorHandle) {
    const handle = normalizeHandle(contributorHandle);
    if (!handle) return { status: "ready", count: 0 };
    return guard<WeatherRecommendationContributorCountResult>({
      context: "countForContributor",
      onSchemaMiss: () =>
        isDeployedProduction()
          ? Promise.resolve(degradedCount())
          : memoryWeatherRecommendationStore.countForContributor(handle),
      message: "countForContributor failed, returning a degraded count",
      onError: degradedCount,
      run: async () => {
        const { count, error } = await requireSupabaseAdmin()
          .from(TABLE)
          .select("id", { count: "exact", head: true })
          .eq("contributor_handle", handle);
        if (error) throw new Error(error.message);
        return { status: "ready", count: count ?? 0 };
      },
    });
  },
};

export function weatherRecommendationStore(): WeatherRecommendationStore {
  return selectStore(
    memoryWeatherRecommendationStore,
    supabaseWeatherRecommendationStore,
  );
}

export function submitWeatherRecommendation(
  input: WeatherRecommendationWrite,
  now?: number,
): Promise<WeatherRecommendation> {
  return weatherRecommendationStore().create(input, now);
}

export function readWeatherRecommendations(
  venueId: string,
): Promise<WeatherRecommendationReadResult> {
  return weatherRecommendationStore().listForVenue(venueId);
}

export function readWeatherRecommendationContributorCount(
  contributorHandle: string,
): Promise<WeatherRecommendationContributorCountResult> {
  return weatherRecommendationStore().countForContributor(contributorHandle);
}

export function __resetWeatherRecommendations(): void {
  memoryRows.clear();
  memoryIdsByNaturalKey.clear();
  resetWarnings();
}
