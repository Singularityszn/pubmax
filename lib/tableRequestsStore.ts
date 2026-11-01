// Table requests store - dual backend (process-memory + Supabase
// public.table_requests, migration 0219).
//
// This store keeps the "Ask the pub for a table" requests PUBMAXX delivered to
// a pub's verified operator, so the operator panel can list them. The one
// writer is app/api/table-requests/route.ts, through
// lib/tableRequestDelivery.server.ts. A request is stored `pending` BEFORE the
// email goes, marked `emailed` once the email was sent, and DISCARDED when it
// was not, because a request PUBMAXX told the person it did not send must not
// sit in a pub's list as if it had. Only `emailed` rows are ever listed.
//
// A row holds the requester's name and the contact they chose for the pub to
// reply to, so browser roles hold no grant at all (0219), and the operator
// read returns `OperatorTableRequest`, which never carries the account id.
//
// It is never a booking and never a payment, and nothing that ranks, colours,
// bands or orders a venue may import it (__tests__/tableRequestFence.test.ts).
//
// Reads are fail-soft. A HARD durable write failure THROWS, and the delivery
// treats that as "not sent" so the person is handed the pub's own address
// instead. A missing table in production is refused on the write path
// (onMissingDurableWrite).

import "server-only";

import { randomUUID } from "crypto";

import {
  TABLE_REQUEST_CONTACT_KINDS,
  TABLE_REQUEST_DELIVERIES,
  type TableRequest,
  type TableRequestContactKind,
  type TableRequestDelivery,
  type TableRequestFields,
} from "@/lib/tableRequests";
import {
  admin,
  createDualBackendStore,
  createFailSoftGuard,
  onMissingDurableWrite,
  whereVenueIdIn,
} from "@/lib/storeBackend";
import { storedVenueIds } from "@/lib/venueAliases";

const TABLE = "table_requests";
const MIGRATION_HINT = "apply migration 0219";
const STORE_TAG = "table-requests";

/** Bounded reads: the operator panel lists at most this many requests. */
export const MAX_TABLE_REQUEST_ROWS = 50;

type TableRequestsRead = { status: "ready" | "degraded"; requests: TableRequest[] };

export type TableRequestsStore = {
  /** Keep a request as `pending` before its email goes. THROWS on a hard failure. */
  create(fields: TableRequestFields, now?: number): Promise<TableRequest>;
  /** Stamp a request `emailed`. False when no pending row has that id. THROWS on a hard failure. */
  markEmailed(id: string, now?: number): Promise<boolean>;
  /** Remove a request whose email was not sent. False when there was none. THROWS on a hard failure. */
  discard(id: string): Promise<boolean>;
  /** Emailed requests for one pub under any of its ids, newest first. Fail-soft (degraded, []). */
  listEmailedForVenue(venueId: string): Promise<TableRequestsRead>;
};

function byNewest(left: TableRequest, right: TableRequest): number {
  return right.createdAt.localeCompare(left.createdAt);
}

// ── Memory ───────────────────────────────────────────────────────────────────
const byId = new Map<string, TableRequest>();

export const memoryTableRequestsStore: TableRequestsStore = {
  async create(fields, now = Date.now()) {
    const request: TableRequest = {
      ...fields,
      id: randomUUID(),
      delivery: "pending",
      createdAt: new Date(now).toISOString(),
      deliveredAt: null,
    };
    byId.set(request.id, request);
    return { ...request };
  },

  async markEmailed(id, now = Date.now()) {
    const hit = byId.get(id);
    if (!hit || hit.delivery !== "pending") return false;
    hit.delivery = "emailed";
    hit.deliveredAt = new Date(now).toISOString();
    return true;
  },

  async discard(id) {
    return byId.delete(id);
  },

  async listEmailedForVenue(venueId) {
    const venueIds = await storedVenueIds(venueId);
    const requests = [...byId.values()]
      .filter((request) => venueIds.includes(request.venueId) && request.delivery === "emailed")
      .sort(byNewest)
      .slice(0, MAX_TABLE_REQUEST_ROWS)
      .map((request) => ({ ...request }));
    return { status: "ready", requests };
  },
};

// ── Supabase ─────────────────────────────────────────────────────────────────
const { guard, resetWarnings } = createFailSoftGuard({
  tag: STORE_TAG,
  tables: [TABLE],
  migrationHint: MIGRATION_HINT,
});

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readContactKind(value: unknown): TableRequestContactKind | null {
  return typeof value === "string" && (TABLE_REQUEST_CONTACT_KINDS as readonly string[]).includes(value)
    ? (value as TableRequestContactKind)
    : null;
}

function readDelivery(value: unknown): TableRequestDelivery | null {
  return typeof value === "string" && (TABLE_REQUEST_DELIVERIES as readonly string[]).includes(value)
    ? (value as TableRequestDelivery)
    : null;
}

function fromRow(row: Record<string, unknown>): TableRequest | null {
  const id = readText(row.id);
  const venueId = readText(row.venue_id);
  const requesterUserId = readText(row.requester_user_id);
  const name = readText(row.requester_name);
  const date = readText(row.requested_date);
  const time = readText(row.requested_time);
  const contactKind = readContactKind(row.contact_kind);
  const contactValue = readText(row.contact_value);
  const delivery = readDelivery(row.delivery);
  const createdAt = readText(row.created_at);
  const partySize = typeof row.party_size === "number" ? row.party_size : Number(row.party_size);
  if (
    !id || !venueId || !requesterUserId || !name || !date || !time ||
    !contactKind || !contactValue || !delivery || !createdAt || !Number.isInteger(partySize)
  ) {
    return null;
  }
  return {
    id,
    venueId,
    requesterUserId,
    name,
    partySize,
    // PostgREST answers a date column as YYYY-MM-DD and a time as HH:MM:SS.
    date: date.slice(0, 10),
    time: time.slice(0, 5),
    note: readText(row.note),
    contactKind,
    contactValue,
    delivery,
    createdAt,
    deliveredAt: readText(row.delivered_at),
  };
}

function toRow(request: TableRequest) {
  return {
    id: request.id,
    venue_id: request.venueId,
    requester_user_id: request.requesterUserId,
    requester_name: request.name,
    party_size: request.partySize,
    requested_date: request.date,
    requested_time: request.time,
    note: request.note,
    contact_kind: request.contactKind,
    contact_value: request.contactValue,
    delivery: request.delivery,
    created_at: request.createdAt,
    delivered_at: request.deliveredAt,
  };
}

export const supabaseTableRequestsStore: TableRequestsStore = {
  async create(fields, now = Date.now()) {
    return guard({
      context: "create",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: STORE_TAG,
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryTableRequestsStore.create(fields, now),
        }),
      // No onError: a hard write failure THROWS.
      run: async () => {
        const request: TableRequest = {
          ...fields,
          id: randomUUID(),
          delivery: "pending",
          createdAt: new Date(now).toISOString(),
          deliveredAt: null,
        };
        const { error } = await admin().from(TABLE).insert(toRow(request));
        if (error) throw new Error(error.message);
        return request;
      },
    });
  },

  async markEmailed(id, now = Date.now()) {
    return guard({
      context: "mark-emailed",
      onSchemaMiss: () => memoryTableRequestsStore.markEmailed(id, now),
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .update({ delivery: "emailed", delivered_at: new Date(now).toISOString() })
          .eq("id", id)
          .eq("delivery", "pending")
          .select("id");
        if (error) throw new Error(error.message);
        return (Array.isArray(data) ? data : []).length > 0;
      },
    });
  },

  async discard(id) {
    return guard({
      context: "discard",
      onSchemaMiss: () => memoryTableRequestsStore.discard(id),
      run: async () => {
        const { data, error } = await admin().from(TABLE).delete().eq("id", id).select("id");
        if (error) throw new Error(error.message);
        return (Array.isArray(data) ? data : []).length > 0;
      },
    });
  },

  async listEmailedForVenue(venueId) {
    return guard({
      context: "list-venue",
      onSchemaMiss: () => memoryTableRequestsStore.listEmailedForVenue(venueId),
      onError: async () => ({ status: "degraded" as const, requests: [] }),
      message: "venue read failed",
      run: async () => {
        const { data, error } = await whereVenueIdIn(
          admin().from(TABLE).select("*"),
          await storedVenueIds(venueId),
        )
          .eq("delivery", "emailed")
          .order("created_at", { ascending: false })
          .limit(MAX_TABLE_REQUEST_ROWS);
        if (error) throw new Error(error.message);
        const requests = (Array.isArray(data) ? data : [])
          .map((row) => fromRow(row as Record<string, unknown>))
          .filter((request): request is TableRequest => request !== null && request.delivery === "emailed")
          .sort(byNewest);
        return { status: "ready" as const, requests };
      },
    });
  },
};

export const tableRequestsStore = createDualBackendStore(
  memoryTableRequestsStore,
  supabaseTableRequestsStore,
);

/** Test-only: clear the in-memory requests and the deduped warnings between cases. */
export function __resetTableRequests(): void {
  byId.clear();
  resetWarnings();
}
