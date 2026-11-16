// Table requests store - dual backend (process-memory + Supabase
// public.table_requests, migrations 0219 and 0241).
//
// Delivery lifecycle and visibility:
// docs/rules/lib-shared-seams-stores-http-freshness-brand.md
// #a-table-request-is-a-message-to-a-pub-and-only-a-send-counts-as-sent.
//
// A row holds the requester's name and the contact they chose for the pub to
// reply to, so browser roles hold no grant at all (0219), and the operator
// read returns `OperatorTableRequest`, which never carries the account id.
//
// It is never a booking and never a payment, and nothing that ranks, colours,
// bands or orders a venue may import it (__tests__/tableRequestFence.test.ts).
//
// A HARD durable write failure THROWS. A missing table in production is
// refused on the write path (onMissingDurableWrite).

import "server-only";

import { randomUUID } from "crypto";

import {
  TABLE_REQUEST_CONTACT_KINDS,
  TABLE_REQUEST_DELIVERIES,
  transitionTableRequestDelivery,
  type TableRequestDeliveryEvent,
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
const MIGRATION_HINT = "apply migration 0241";
const STORE_TAG = "table-requests";

/** Bounded reads: the operator panel lists at most this many requests. */
const MAX_TABLE_REQUEST_ROWS = 50;
/** The account export's read of the requester's own rows, at most. */
const MAX_OWNER_ROWS = 200;

type TableRequestsRead = { status: "ready" | "degraded"; requests: TableRequest[] };

export type TableRequestsStore = {
  findForRequester(id: string, requesterUserId: string): Promise<TableRequest | null>;
  /** Store a request. Given an `id` that is already stored, it changes nothing and returns it. */
  create(fields: TableRequestFields, now?: number, id?: string, initial?: "pending" | "resolving"): Promise<TableRequest>;
  /** Compare the state and revision. Null means the claim was refused. */
  transition(request: TableRequest, event: TableRequestDeliveryEvent, now?: number): Promise<TableRequest | null>;
  /** THROWS on a hard failure. False when the pending state or revision does not match. */
  markEmailed(id: string, now?: number, revision?: number): Promise<boolean>;
  /** Remove a request whose email was not sent. False when there was none. THROWS on a hard failure. */
  discard(id: string): Promise<boolean>;
  /** Emailed requests for one pub under any of its ids, newest first. Fail-soft (degraded, []). */
  listEmailedForVenue(venueId: string): Promise<TableRequestsRead>;
  /** The requester's own stored requests, newest first (the account export). Fail-soft (degraded, []). */
  listForRequester(requesterUserId: string, limit?: number): Promise<TableRequestsRead>;
};

function byNewest(left: TableRequest, right: TableRequest): number {
  return right.createdAt.localeCompare(left.createdAt);
}

// ── Memory ───────────────────────────────────────────────────────────────────
const byId = new Map<string, TableRequest>();

export const memoryTableRequestsStore: TableRequestsStore = {
  async findForRequester(id, requesterUserId) {
    const request = byId.get(id);
    return request?.requesterUserId === requesterUserId ? { ...request } : null;
  },

  async create(fields, now = Date.now(), id = randomUUID(), initial = "pending") {
    const held = byId.get(id);
    if (held) return { ...held };
    const request: TableRequest = {
      ...fields,
      id,
      delivery: initial,
      revision: 0,
      createdAt: new Date(now).toISOString(),
      deliveredAt: null,
    };
    byId.set(request.id, request);
    return { ...request };
  },

  async transition(request, event, now = Date.now()) {
    const held = byId.get(request.id);
    if (!held || held.requesterUserId !== request.requesterUserId || held.delivery !== request.delivery) return null;
    const next = transitionTableRequestDelivery(held, event, request.revision, now);
    if (next === held) return null;
    const updated = { ...held, ...next };
    byId.set(request.id, updated);
    return { ...updated };
  },

  async markEmailed(id, now = Date.now(), revision = 0) {
    const held = byId.get(id);
    return held ? (await memoryTableRequestsStore.transition({ ...held, revision }, "confirm_sent", now)) !== null : false;
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

  async listForRequester(requesterUserId, limit = MAX_OWNER_ROWS) {
    const requests = [...byId.values()]
      .filter((request) => request.requesterUserId === requesterUserId)
      .sort(byNewest)
      .slice(0, Math.max(1, Math.floor(limit)))
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
  const revision = row.revision ?? 0;
  const deliveredAt = readText(row.delivered_at);
  const partySize = typeof row.party_size === "number" ? row.party_size : Number(row.party_size);
  if (
    !id || !venueId || !requesterUserId || !name || !date || !time ||
    !contactKind || !contactValue || !delivery || !createdAt || !Number.isInteger(partySize) ||
    !Number.isSafeInteger(revision) || (revision as number) < 0 ||
    ((delivery === "emailed") !== (deliveredAt !== null))
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
    createdAt,
    revision: revision as number,
    ...(delivery === "emailed" ? { delivery, deliveredAt: deliveredAt! } : { delivery, deliveredAt: null }),
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
    revision: request.revision,
    created_at: request.createdAt,
    delivered_at: request.deliveredAt,
  };
}

export const supabaseTableRequestsStore: TableRequestsStore = {
  async findForRequester(id, requesterUserId) {
    return guard({
      context: "find-requester",
      onSchemaMiss: () => onMissingDurableWrite({
        storeTag: STORE_TAG,
        migrationHint: MIGRATION_HINT,
        fallback: () => memoryTableRequestsStore.findForRequester(id, requesterUserId),
      }),
      run: async () => {
        const { data, error } = await admin().from(TABLE).select("*")
          .eq("id", id).eq("requester_user_id", requesterUserId).maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) return null;
        const request = fromRow(data as Record<string, unknown>);
        if (!request) throw new Error("table request could not be read");
        return request;
      },
    });
  },

  async create(fields, now = Date.now(), id = randomUUID(), initial = "pending") {
    return guard({
      context: "create",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: STORE_TAG,
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryTableRequestsStore.create(fields, now, id, initial),
        }),
      // No onError: a hard write failure THROWS.
      run: async () => {
        const request: TableRequest = {
          ...fields,
          id,
          delivery: initial,
          revision: 0,
          createdAt: new Date(now).toISOString(),
          deliveredAt: null,
        };
        const { error } = await admin().from(TABLE).insert(toRow(request));
        if (!error) return request;
        // The primary key is the table's only unique key: a retry of a stored request.
        if (error.code !== "23505") throw new Error(error.message);
        const stored = await supabaseTableRequestsStore.findForRequester(id, fields.requesterUserId);
        if (!stored) throw new Error("table request vanished during a retry");
        return stored;
      },
    });
  },

  async transition(request, event, now = Date.now()) {
    const next = transitionTableRequestDelivery(request, event, request.revision, now);
    if (next === request) return null;
    return guard({
      context: "transition",
      onSchemaMiss: () => onMissingDurableWrite({
        storeTag: STORE_TAG,
        migrationHint: MIGRATION_HINT,
        fallback: () => memoryTableRequestsStore.transition(request, event, now),
      }),
      run: async () => {
        const { data, error } = await admin().rpc("transition_table_request", {
          p_id: request.id,
          p_requester: request.requesterUserId,
          p_from: request.delivery,
          p_revision: request.revision,
          p_to: next.delivery,
          p_delivered_at: next.deliveredAt,
        });
        if (error) throw new Error(error.message);
        if (!data?.length) return null;
        const updated = fromRow(data[0] as Record<string, unknown>);
        if (!updated) throw new Error("table request transition could not be read");
        return updated;
      },
    });
  },

  async markEmailed(id, now = Date.now(), revision = 0) {
    const { data, error } = await admin().from(TABLE).select("*").eq("id", id).maybeSingle();
    if (error) {
      return guard({
        context: "mark-emailed",
        onSchemaMiss: () => onMissingDurableWrite({
          storeTag: STORE_TAG, migrationHint: MIGRATION_HINT,
          fallback: () => memoryTableRequestsStore.markEmailed(id, now, revision),
        }),
        run: async () => { throw new Error(error.message); },
      });
    }
    const request = data ? fromRow(data as Record<string, unknown>) : null;
    return request ? (await supabaseTableRequestsStore.transition({ ...request, revision }, "confirm_sent", now)) !== null : false;
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

  async listForRequester(requesterUserId, limit = MAX_OWNER_ROWS) {
    return guard({
      context: "list-requester",
      onSchemaMiss: () => memoryTableRequestsStore.listForRequester(requesterUserId, limit),
      onError: async () => ({ status: "degraded" as const, requests: [] }),
      message: "requester read failed",
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("*")
          .eq("requester_user_id", requesterUserId)
          .order("created_at", { ascending: false })
          .limit(Math.max(1, Math.floor(limit)));
        if (error) throw new Error(error.message);
        const requests = (Array.isArray(data) ? data : [])
          .map((row) => fromRow(row as Record<string, unknown>))
          .filter((request): request is TableRequest => request !== null && request.requesterUserId === requesterUserId)
          .sort(byNewest)
          .slice(0, Math.max(1, Math.floor(limit)));
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
