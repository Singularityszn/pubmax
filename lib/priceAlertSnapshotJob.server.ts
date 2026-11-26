import "server-only";

import { randomUUID } from "node:crypto";
import { requireDynamicSupabaseAdmin } from "@/lib/supabase";
import { selectStore } from "@/lib/storeBackend";
import { transitionPriceAlertSnapshot, type PriceAlertSnapshotState } from "@/lib/priceAlertSnapshotMachine";
import manifest from "@/public/data/uk_prices/manifest.json";

type Phase = PriceAlertSnapshotState["phase"];
type SnapshotProgress = { phase: Phase; observationOffset: number; eventOffset: number; recipientCursor: string | null; retryUser: string | null; retryEvent: string | null };
type Entry = SnapshotProgress & { lease: string | null; leaseUntil: number };
type SnapshotStore = {
  claim(version: string, lease: string): Promise<SnapshotProgress | null>;
  observe(version: string, lease: string, offset: number, ids: string[], last: boolean): Promise<void>;
  advance(version: string, lease: string, offset: number, cursor: string | null, complete: boolean, release: boolean): Promise<void>;
  advanceRetry(version: string, lease: string, userId: string | null, eventId: string | null): Promise<void>;
};
type Membership = "present" | "missing" | "superseded";
const entries = new Map<string, Entry>();
const observed = new Map<string, string>();
const members = new Map<string, string>();
export function resetPriceAlertSnapshotForTests(): void { entries.clear(); observed.clear(); members.clear(); }
const memory: SnapshotStore & { firstSeen(ids: string[]): Promise<Map<string, string>>; membership(version: string, id: string): Promise<Membership> } = {
  async claim(version, lease) {
    if ([...entries.values()].some((item) => item.lease && item.leaseUntil > Date.now())) return null;
    const entry = entries.get(version) ?? { phase: "indexing", observationOffset: 0, eventOffset: 0, recipientCursor: null, retryUser: null, retryEvent: null, lease: null, leaseUntil: 0 };
    entry.lease = lease;
    entry.leaseUntil = Date.now() + 35_000;
    entries.set(version, entry);
    return { phase: entry.phase, observationOffset: entry.observationOffset, eventOffset: entry.eventOffset, recipientCursor: entry.recipientCursor, retryUser: entry.retryUser, retryEvent: entry.retryEvent };
  },
  async observe(version, lease, offset, ids, last) {
    const entry = entries.get(version);
    if (!entry || entry.lease !== lease || entry.leaseUntil <= Date.now() || entry.phase !== "indexing" || entry.observationOffset !== offset) throw new Error("Price alert snapshot lease lost");
    for (const id of ids) if (!observed.has(id)) observed.set(id, new Date().toISOString());
    for (const id of ids) if (!members.has(id) || members.get(id)! < version) members.set(id, version);
    entry.observationOffset += ids.length;
    entry.phase = transitionPriceAlertSnapshot({ phase: entry.phase }, { type: "observed", last }).phase;
  },
  async advance(version, lease, offset, cursor, complete, release) {
    const entry = entries.get(version);
    if (!entry || entry.lease !== lease || entry.leaseUntil <= Date.now()) throw new Error("Price alert snapshot lease lost");
    entry.eventOffset = offset;
    entry.recipientCursor = cursor;
    entry.phase = transitionPriceAlertSnapshot({ phase: entry.phase }, { type: "advanced", complete }).phase;
    if (release) entry.lease = null;
  },
  async advanceRetry(version, lease, userId, eventId) {
    const entry = entries.get(version);
    if (!entry || entry.lease !== lease || entry.leaseUntil <= Date.now()) throw new Error("Price alert snapshot lease lost");
    entry.retryUser = userId;
    entry.retryEvent = eventId;
  },
  async firstSeen(ids) { return new Map(ids.flatMap((id) => { const date = observed.get(id); return date ? [[id, date] as const] : []; })); },
  async membership(version, id) { const latest = members.get(id); return latest === version ? "present" : latest && latest > version ? "superseded" : "missing"; },
};
const durable: SnapshotStore & { firstSeen(ids: string[]): Promise<Map<string, string>>; membership(version: string, id: string): Promise<Membership> } = {
  async claim(version, lease) {
    const { data, error } = await requireDynamicSupabaseAdmin().rpc("claim_price_alert_snapshot", { p_version: version, p_lease: lease } as never);
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] as { phase: Phase; observation_offset: number; event_offset: number; recipient_cursor: string | null } | undefined : undefined;
    if (!row) return null;
    const saved = await requireDynamicSupabaseAdmin().from("price_alert_snapshot_jobs").select("retry_user, retry_event").eq("version", version).eq("lease", lease).maybeSingle();
    if (saved.error || !saved.data) throw saved.error ?? new Error("Price alert snapshot lease lost");
    return { phase: row.phase, observationOffset: row.observation_offset, eventOffset: row.event_offset, recipientCursor: row.recipient_cursor, retryUser: saved.data.retry_user as string | null, retryEvent: saved.data.retry_event as string | null };
  },
  async observe(version, lease, offset, ids, last) {
    const { data, error } = await requireDynamicSupabaseAdmin().rpc("observe_price_alert_snapshot", { p_version: version, p_lease: lease, p_offset: offset, p_ids: ids, p_last: last } as never);
    if (error) throw error;
    if (data !== true) throw new Error("Price alert snapshot lease lost");
  },
  async advance(version, lease, offset, cursor, complete, release) {
    const { data, error } = await requireDynamicSupabaseAdmin().rpc("advance_price_alert_snapshot", { p_version: version, p_lease: lease, p_event_offset: offset, p_recipient_cursor: cursor, p_complete: complete, p_release: release } as never);
    if (error) throw error;
    if (data !== true) throw new Error("Price alert snapshot lease lost");
  },
  async advanceRetry(version, lease, userId, eventId) {
    const { data, error } = await requireDynamicSupabaseAdmin().rpc("advance_price_alert_retry", { p_version: version, p_lease: lease, p_user: userId, p_event: eventId } as never);
    if (error) throw error;
    if (data !== true) throw new Error("Price alert snapshot lease lost");
  },
  async firstSeen(ids) {
    const result = new Map<string, string>();
    let after: string | null = null;
    while (result.size < ids.length) {
      let query = requireDynamicSupabaseAdmin().from("price_alert_listing_seen").select("event_id, first_seen").in("event_id", ids).order("event_id").limit(100);
      if (after) query = query.gt("event_id", after);
      const { data, error } = await query;
      if (error) throw error;
      if (!data?.length) return result;
      for (const row of data) result.set(String(row.event_id), String(row.first_seen));
      after = String(data[data.length - 1]!.event_id);
    }
    return result;
  },
  async membership(version, id) {
    const { data, error } = await requireDynamicSupabaseAdmin().from("price_alert_listing_seen").select("last_snapshot").eq("event_id", id).maybeSingle();
    if (error) throw error;
    const latest = typeof data?.last_snapshot === "string" ? data.last_snapshot : null;
    return latest === version ? "present" : latest && latest > version ? "superseded" : "missing";
  },
};
export function priceAlertSnapshotStore() { return selectStore(memory, durable); }
export function priceAlertSnapshotVersion() { return manifest.generatedAt; }
export function newPriceAlertSnapshotLease() { return randomUUID(); }
