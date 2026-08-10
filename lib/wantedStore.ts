// Wanted store — dual backend (process-memory + Supabase public.wanteds).
// Private to the owner actor. Service-role writes; RLS owner-only for JWT.

import { randomUUID } from "node:crypto";

import {
  admin,
  createDualBackendStore,
  createFailSoftGuard,
  onMissingDurableWrite,
} from "@/lib/storeBackend";
import { isDrinkCategory } from "@/lib/drinks";
import { cleanWantedVisibility, type Wanted, type WantedDTO, type WantedFields, type WantedStatus, type WantedVisibility } from "@/lib/wanted";

const TABLE = "wanteds";
const MIGRATION_HINT = "apply migration 0104";

export type WantedStore = {
  create(fields: WantedFields, now?: number): Promise<WantedDTO>;
  listForOwner(ownerActor: string): Promise<{ status: "ready" | "degraded"; wanteds: WantedDTO[] }>;
  listOpenForOwner(ownerActor: string): Promise<{ status: "ready" | "degraded"; wanteds: WantedDTO[] }>;
  listForMutualOwners(ownerActors: readonly string[]): Promise<{ status: "ready" | "degraded"; wanteds: WantedDTO[] }>;
  listForCrew(crewId: string): Promise<{ status: "ready" | "degraded"; wanteds: WantedDTO[] }>;
  /** Mark open Wanteds for this owner+venue fulfilled. Returns fulfilled rows. */
  fulfilForVenue(
    ownerActor: string,
    venueId: string,
    now?: number,
  ): Promise<WantedDTO[]>;
  delete(ownerActor: string, id: string): Promise<boolean>;
  getById(ownerActor: string, id: string): Promise<WantedDTO | null>;
  updateVisibility(ownerActor: string, id: string, visibility: WantedVisibility): Promise<WantedDTO | null>;
};

function toDTO(row: Wanted): WantedDTO {
  return { ...row };
}

// ── Memory ───────────────────────────────────────────────────────────────────
const byId = new Map<string, Wanted>();

function memoryList(ownerActor: string, openOnly: boolean): WantedDTO[] {
  return Array.from(byId.values())
    .filter((row) => {
      if (row.ownerActor !== ownerActor) return false;
      if (openOnly && row.status !== "open") return false;
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(toDTO);
}

function memorySharedList(
  predicate: (row: Wanted) => boolean,
): WantedDTO[] {
  return Array.from(byId.values())
    .filter(predicate)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(toDTO);
}

export const memoryWantedStore: WantedStore = {
  async create(fields, now = Date.now()) {
    const wanted: Wanted = {
      id: randomUUID(),
      ...fields,
      status: "open",
      createdAt: new Date(now).toISOString(),
      fulfilledAt: null,
    };
    byId.set(wanted.id, wanted);
    return toDTO(wanted);
  },

  async listForOwner(ownerActor) {
    return { status: "ready", wanteds: memoryList(ownerActor, false) };
  },

  async listOpenForOwner(ownerActor) {
    return { status: "ready", wanteds: memoryList(ownerActor, true) };
  },

  async listForMutualOwners(ownerActors) {
    const allowed = new Set(ownerActors);
    return {
      status: "ready",
      wanteds: memorySharedList((row) => row.visibility === "mutuals" && allowed.has(row.ownerActor)),
    };
  },

  async listForCrew(crewId) {
    return {
      status: "ready",
      wanteds: memorySharedList((row) => row.visibility === `crew:${crewId}`),
    };
  },

  async fulfilForVenue(ownerActor, venueId, now = Date.now()) {
    if (!venueId) return [];
    const stamp = new Date(now).toISOString();
    const fulfilled: WantedDTO[] = [];
    for (const row of byId.values()) {
      if (row.ownerActor !== ownerActor) continue;
      if (row.status !== "open") continue;
      if (row.venueId !== venueId) continue;
      row.status = "fulfilled";
      row.fulfilledAt = stamp;
      fulfilled.push(toDTO(row));
    }
    return fulfilled;
  },

  async delete(ownerActor, id) {
    const hit = byId.get(id);
    if (!hit || hit.ownerActor !== ownerActor) return false;
    byId.delete(id);
    return true;
  },

  async getById(ownerActor, id) {
    const hit = byId.get(id);
    if (!hit || hit.ownerActor !== ownerActor) return null;
    return toDTO(hit);
  },

  async updateVisibility(ownerActor, id, visibility) {
    const hit = byId.get(id);
    if (!hit || hit.ownerActor !== ownerActor) return null;
    hit.visibility = visibility;
    return toDTO(hit);
  },
};

// ── Supabase ─────────────────────────────────────────────────────────────────
const { guard } = createFailSoftGuard({
  tag: "wanteds",
  tables: TABLE,
  migrationHint: MIGRATION_HINT,
});

function toRow(wanted: Wanted) {
  return {
    id: wanted.id,
    owner_actor: wanted.ownerActor,
    venue_kind: wanted.venueKind,
    venue_id: wanted.venueId || null,
    venue_name: wanted.venueName || null,
    source_url: wanted.sourceUrl || null,
    source_platform: wanted.sourcePlatform,
    note: wanted.note,
    raw_paste: wanted.rawPaste,
    drink_interest: wanted.drinkInterest,
    visibility: wanted.visibility,
    status: wanted.status,
    created_at: wanted.createdAt,
    fulfilled_at: wanted.fulfilledAt,
  };
}

function fromRow(row: Record<string, unknown>): Wanted | null {
  const id = typeof row.id === "string" ? row.id : "";
  const ownerActor = typeof row.owner_actor === "string" ? row.owner_actor : "";
  if (!id || !ownerActor) return null;
  const venueKind =
    row.venue_kind === "uk_base" || row.venue_kind === "pending" || row.venue_kind === "curated"
      ? row.venue_kind
      : "pending";
  const status: WantedStatus = row.status === "fulfilled" ? "fulfilled" : "open";
  const platform =
    row.source_platform === "instagram" ||
    row.source_platform === "tiktok" ||
    row.source_platform === "youtube" ||
    row.source_platform === "other" ||
    row.source_platform === "none"
      ? row.source_platform
      : "none";
  const drinkInterest = isDrinkCategory(row.drink_interest) ? row.drink_interest : null;
  const visibility = cleanWantedVisibility(row.visibility) ?? "private";
  return {
    id,
    ownerActor,
    venueKind,
    venueId: typeof row.venue_id === "string" ? row.venue_id : "",
    venueName: typeof row.venue_name === "string" ? row.venue_name : "",
    sourceUrl: typeof row.source_url === "string" ? row.source_url : "",
    sourcePlatform: platform,
    note: typeof row.note === "string" ? row.note : "",
    rawPaste: typeof row.raw_paste === "string" ? row.raw_paste : "",
    drinkInterest,
    visibility,
    status,
    createdAt: typeof row.created_at === "string" ? row.created_at : new Date(0).toISOString(),
    fulfilledAt: typeof row.fulfilled_at === "string" ? row.fulfilled_at : null,
  };
}

export const supabaseWantedStore: WantedStore = {
  async create(fields, now = Date.now()) {
    const wanted: Wanted = {
      id: randomUUID(),
      ...fields,
      status: "open",
      createdAt: new Date(now).toISOString(),
      fulfilledAt: null,
    };
    return guard({
      context: "create",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "wanteds",
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryWantedStore.create(fields, now),
        }),
      run: async () => {
        const { error } = await admin().from(TABLE).insert(toRow(wanted));
        if (error) throw new Error(error.message);
        return toDTO(wanted);
      },
    });
  },

  async listForOwner(ownerActor) {
    return guard({
      context: "list",
      onSchemaMiss: async () => memoryWantedStore.listForOwner(ownerActor),
      onError: async () => ({ status: "degraded" as const, wanteds: [] }),
      message: "list failed",
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("*")
          .eq("owner_actor", ownerActor)
          .order("created_at", { ascending: false });
        if (error) throw new Error(error.message);
        const wanteds = (data ?? [])
          .map((row) => fromRow(row as Record<string, unknown>))
          .filter((row): row is Wanted => row !== null)
          .map(toDTO);
        return { status: "ready" as const, wanteds };
      },
    });
  },

  async listOpenForOwner(ownerActor) {
    const all = await this.listForOwner(ownerActor);
    return {
      status: all.status,
      wanteds: all.wanteds.filter((row) => row.status === "open"),
    };
  },

  async listForMutualOwners(ownerActors) {
    if (ownerActors.length === 0) return { status: "ready", wanteds: [] };
    return guard({
      context: "list-mutuals",
      onSchemaMiss: async () => memoryWantedStore.listForMutualOwners(ownerActors),
      onError: async () => ({ status: "degraded" as const, wanteds: [] }),
      message: "list mutual Wanteds failed",
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("*")
          .in("owner_actor", [...ownerActors])
          .eq("visibility", "mutuals")
          .order("created_at", { ascending: false });
        if (error) throw new Error(error.message);
        const wanteds = (data ?? [])
          .map((row) => fromRow(row as Record<string, unknown>))
          .filter((row): row is Wanted => row !== null)
          .map(toDTO);
        return { status: "ready" as const, wanteds };
      },
    });
  },

  async listForCrew(crewId) {
    return guard({
      context: "list-crew",
      onSchemaMiss: async () => memoryWantedStore.listForCrew(crewId),
      onError: async () => ({ status: "degraded" as const, wanteds: [] }),
      message: "list Crew Wanteds failed",
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("*")
          .eq("visibility", `crew:${crewId}`)
          .order("created_at", { ascending: false });
        if (error) throw new Error(error.message);
        const wanteds = (data ?? [])
          .map((row) => fromRow(row as Record<string, unknown>))
          .filter((row): row is Wanted => row !== null)
          .map(toDTO);
        return { status: "ready" as const, wanteds };
      },
    });
  },

  async fulfilForVenue(ownerActor, venueId, now = Date.now()) {
    if (!venueId) return [];
    const stamp = new Date(now).toISOString();
    return guard({
      context: "fulfil",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "wanteds",
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryWantedStore.fulfilForVenue(ownerActor, venueId, now),
        }),
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .update({ status: "fulfilled", fulfilled_at: stamp })
          .eq("owner_actor", ownerActor)
          .eq("venue_id", venueId)
          .eq("status", "open")
          .select("*");
        if (error) throw new Error(error.message);
        return (data ?? [])
          .map((row) => fromRow(row as Record<string, unknown>))
          .filter((row): row is Wanted => row !== null)
          .map(toDTO);
      },
    });
  },

  async delete(ownerActor, id) {
    return guard({
      context: "delete",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "wanteds",
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryWantedStore.delete(ownerActor, id),
        }),
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .delete()
          .eq("id", id)
          .eq("owner_actor", ownerActor)
          .select("id");
        if (error) throw new Error(error.message);
        return (data ?? []).length > 0;
      },
    });
  },

  async getById(ownerActor, id) {
    return guard({
      context: "get",
      onSchemaMiss: async () => memoryWantedStore.getById(ownerActor, id),
      onError: async () => null,
      message: "get failed",
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("*")
          .eq("id", id)
          .eq("owner_actor", ownerActor)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) return null;
        const row = fromRow(data as Record<string, unknown>);
        return row ? toDTO(row) : null;
      },
    });
  },

  async updateVisibility(ownerActor, id, visibility) {
    return guard({
      context: "visibility",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "wanteds",
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryWantedStore.updateVisibility(ownerActor, id, visibility),
        }),
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .update({ visibility })
          .eq("id", id)
          .eq("owner_actor", ownerActor)
          .select("*")
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) return null;
        const row = fromRow(data as Record<string, unknown>);
        return row ? toDTO(row) : null;
      },
    });
  },
};

export const wantedStore = createDualBackendStore(memoryWantedStore, supabaseWantedStore);

/** Test-only: clear the in-memory Wanted rows between cases. */
export function __resetWanteds(): void {
  byId.clear();
}
