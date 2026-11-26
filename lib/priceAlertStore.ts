import "server-only";

import { randomUUID } from "node:crypto";
import { admin, selectStore } from "@/lib/storeBackend";
import { requireDynamicSupabaseAdmin } from "@/lib/supabase";
import { isPriceAlertThreshold, matchesPriceAlert, PRICE_ALERT_THRESHOLD_PENCE, type PriceAlertObservation } from "@/lib/priceAlert";
import { NIGHT_AREA_SLUGS } from "@/lib/nightAreaSlugs";
import { londonDayKey } from "@/lib/londonHour";
import type { PriceAlertEvent } from "@/lib/priceAlertDispatch.server";

type Setting = { area: string; thresholdPence: number; token: string };
type StoredSetting = Setting & { status: "pending" | "active" };
type Recipient = Setting & { userId: string; enabled: true; enabledAt: string };
type Backlog = { failed: number; retryable: number; uncertain: number; oldestPending: string | null };
type RetryItem = { recipient: Recipient; event: PriceAlertEvent; recordedAt: string };
type Store = {
  get(userId: string): Promise<StoredSetting | null>;
  save(userId: string, setting: Setting, snapshot?: string): Promise<void>;
  remove(userId: string): Promise<void>;
  removeIfToken(userId: string, token: string): Promise<void>;
  list(observation: PriceAlertObservation): Promise<Recipient[]>;
  listAll(after?: string | null, limit?: number): Promise<Recipient[]>;
  earliestEnabledAt(): Promise<string | null>;
  claim(userId: string, eventId: string, setting: Setting, recordedAt: string, attempt?: string, event?: PriceAlertEvent): Promise<boolean>;
  settle(userId: string, eventId: string, attempt: string, state: "retryable" | "delivered" | "terminal" | "unknown"): Promise<void>;
  backlog(): Promise<Backlog>;
  activatePending(version: string, lease: string, limit: number): Promise<number>;
  retryPage(afterUser: string | null, afterEvent: string | null, limit: number): Promise<RetryItem[]>;
  dismissRetry(userId: string, eventId: string): Promise<void>;
};

const preferences = new Map<string, StoredSetting & { enabledAt: string; pendingSnapshot: string | null }>();
const claims = new Map<string, { userId: string; eventId: string; area: string; state: "sending" | "retryable" | "delivered" | "terminal" | "unknown"; attempt: string; queuedAt: string; event?: PriceAlertEvent; recordedAt: string }>();
const dailyClaims = new Map<string, string>();

export function __resetPriceAlertStore(): void {
  preferences.clear();
  claims.clear();
  dailyClaims.clear();
}

const memory: Store = {
  async get(userId) { return preferences.get(userId) ?? null; },
  async save(userId, setting, snapshot) {
    if (!isPriceAlertThreshold(setting.thresholdPence)) throw new Error("Invalid price alert threshold");
    for (const [owner, current] of preferences) {
      if (owner !== userId && current.token === setting.token) preferences.delete(owner);
    }
    const previous = preferences.get(userId);
    const enabledAt = previous && previous.area === setting.area
      ? previous.enabledAt : new Date().toISOString();
    const status = previous && previous.area === setting.area ? previous.status : "pending";
    const pendingSnapshot = previous && previous.area === setting.area ? previous.pendingSnapshot : snapshot ?? null;
    preferences.set(userId, { ...setting, enabledAt, status, pendingSnapshot });
  },
  async remove(userId) { preferences.delete(userId); },
  async removeIfToken(userId, token) { if (preferences.get(userId)?.token === token) preferences.delete(userId); },
  async list(observation) { return [...preferences].filter(([, setting]) => setting.status === "active").map(([userId, setting]) => ({ userId, ...setting, enabled: true as const })).filter((setting) => matchesPriceAlert(setting, observation)); },
  async listAll(after = null, limit = 25) { return [...preferences].filter(([userId, setting]) => (!after || userId > after) && setting.status === "active" && !dailyClaims.has(JSON.stringify([userId, setting.area, londonDayKey(new Date())]))).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).slice(0, limit).map(([userId, setting]) => ({ userId, ...setting, enabled: true as const })); },
  async earliestEnabledAt() {
    return [...preferences.values()].reduce<string | null>((earliest, setting) =>
      setting.status === "active" && (earliest === null || setting.enabledAt < earliest) ? setting.enabledAt : earliest, null);
  },
  async claim(userId, eventId, setting, recordedAt, attempt = randomUUID(), event) {
    const current = preferences.get(userId);
    if (!current || current.status !== "active" || current.token !== setting.token || current.area !== setting.area || current.thresholdPence !== setting.thresholdPence) return false;
    const recorded = Date.parse(recordedAt);
    if (!Number.isFinite(recorded) || recorded <= Date.parse(current.enabledAt) || recorded > Date.now()) return false;
    const key = JSON.stringify([userId, eventId]);
    const day = JSON.stringify([userId, setting.area, londonDayKey(new Date())]);
    const previous = claims.get(key);
    if (previous?.state === "retryable" && previous.area === setting.area && (!dailyClaims.has(day) || dailyClaims.get(day) === key)) {
      previous.state = "sending";
      previous.attempt = attempt;
      dailyClaims.set(day, key);
      return true;
    }
    if (previous || dailyClaims.has(day)) return false;
    claims.set(key, { userId, eventId, area: setting.area, state: "sending", attempt, queuedAt: new Date().toISOString(), event, recordedAt });
    dailyClaims.set(day, key);
    return true;
  },
  async settle(userId, eventId, attempt, state) {
    const claim = claims.get(JSON.stringify([userId, eventId]));
    if (!claim || claim.state !== "sending" || claim.attempt !== attempt) throw new Error("Price alert claim was lost");
    claim.state = state;
  },
  async backlog() {
    const pending = [...claims.values()].filter((item) => {
      const pref = preferences.get(item.userId);
      return pref?.status === "active" && pref.area === item.area && Date.parse(item.recordedAt) > Date.parse(pref.enabledAt) && (item.state === "retryable" || item.state === "sending" || item.state === "unknown");
    });
    return { failed: [...claims.values()].filter((item) => item.state === "terminal").length, retryable: pending.filter((item) => item.state === "retryable").length, uncertain: pending.filter((item) => item.state !== "retryable").length, oldestPending: pending.map((item) => item.queuedAt).sort()[0] ?? null };
  },
  async activatePending(version, _lease, limit) {
    let activated = 0;
    for (const item of preferences.values()) {
      if (item.status !== "pending" || (item.pendingSnapshot && item.pendingSnapshot > version) || activated >= limit) continue;
      item.status = "active";
      item.pendingSnapshot = null;
      item.enabledAt = new Date().toISOString();
      activated++;
    }
    return activated;
  },
  async retryPage(afterUser, afterEvent, limit) {
    return [...claims.values()].filter((claim) => {
      const pref = preferences.get(claim.userId);
      return claim.state === "retryable" && claim.event && pref?.status === "active" && pref.area === claim.area && Date.parse(claim.recordedAt) > Date.parse(pref.enabledAt) && (!afterUser || claim.userId > afterUser || (claim.userId === afterUser && claim.eventId > (afterEvent ?? "")));
    }).sort((a, b) => a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0).slice(0, limit).map((claim) => ({ recipient: { userId: claim.userId, ...preferences.get(claim.userId)!, enabled: true as const }, event: claim.event!, recordedAt: claim.recordedAt }));
  },
  async dismissRetry(userId, eventId) {
    const key = JSON.stringify([userId, eventId]);
    if (claims.get(key)?.state !== "retryable") return;
    claims.delete(key);
    for (const [day, owner] of dailyClaims) if (owner === key) dailyClaims.delete(day);
  },
};

const durable: Store = {
  async get(userId) {
    const { data, error } = await requireDynamicSupabaseAdmin().from("price_alert_preferences").select("area, threshold_pence, token, activation_state").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    if (data.activation_state !== "pending" && data.activation_state !== "active") throw new Error("Invalid price alert state");
    return { area: String(data.area), thresholdPence: Number(data.threshold_pence), token: String(data.token), status: data.activation_state };
  },
  async save(userId, setting, snapshot) {
    if (!isPriceAlertThreshold(setting.thresholdPence)) throw new Error("Invalid price alert threshold");
    const { error } = await requireDynamicSupabaseAdmin().rpc("bind_price_alert_snapshot", { p_user_id: userId, p_area: setting.area, p_threshold_pence: setting.thresholdPence, p_token: setting.token, p_snapshot: snapshot } as never);
    if (error) throw error;
  },
  async remove(userId) {
    const { error } = await admin().from("price_alert_preferences").delete().eq("user_id", userId);
    if (error) throw error;
  },
  async removeIfToken(userId, token) {
    const { error } = await admin().from("price_alert_preferences").delete().eq("user_id", userId).eq("token", token);
    if (error) throw error;
  },
  async list(observation) {
    const rows: Recipient[] = [];
    const pageSize = 500;
    const areas = NIGHT_AREA_SLUGS.filter((area) => matchesPriceAlert({ area, thresholdPence: PRICE_ALERT_THRESHOLD_PENCE, enabled: true }, observation));
    if (!areas.length) return rows;
    let after = "";
    for (;;) {
      let query = requireDynamicSupabaseAdmin().from("price_alert_preferences").select("user_id, area, threshold_pence, token, enabled_at").eq("activation_state", "active").in("area", areas).eq("threshold_pence", PRICE_ALERT_THRESHOLD_PENCE).order("user_id").limit(pageSize);
      if (after) query = query.gt("user_id", after);
      const { data, error } = await query;
      if (error) throw error;
      rows.push(...(data ?? []).map((row) => ({ userId: String(row.user_id), area: String(row.area), thresholdPence: Number(row.threshold_pence), token: String(row.token), enabledAt: String(row.enabled_at), enabled: true as const })));
      if (!data || data.length < pageSize) return rows;
      const last = data.at(-1);
      if (!last) return rows;
      after = String(last.user_id);
    }
  },
  async listAll(after = null, limit = 25) {
    const { data, error } = await admin().rpc("price_alert_due", { p_after_user: after, p_limit: limit });
    if (error) throw error;
    return (data ?? []).map((row: { user_id: string; area: string; threshold_pence: number; token: string; enabled_at: string }) => ({ userId: String(row.user_id), area: String(row.area), thresholdPence: Number(row.threshold_pence), token: String(row.token), enabledAt: String(row.enabled_at), enabled: true as const }));
  },
  async earliestEnabledAt() {
    const { data, error } = await requireDynamicSupabaseAdmin().from("price_alert_preferences").select("enabled_at").eq("activation_state", "active").order("enabled_at").limit(1).maybeSingle();
    if (error) throw error;
    return data ? String(data.enabled_at) : null;
  },
  async claim(userId, eventId, setting, recordedAt, attempt = randomUUID(), event) {
    if (!event) throw new Error("Price alert event is required");
    const { data, error } = await requireDynamicSupabaseAdmin().rpc("claim_price_alert_event", { p_user_id: userId, p_event_id: eventId, p_token: setting.token, p_area: setting.area, p_threshold_pence: setting.thresholdPence, p_recorded_at: recordedAt, p_attempt: attempt, p_event: event } as never);
    if (error) throw error;
    return data === true;
  },
  async settle(userId, eventId, attempt, state) {
    const { data, error } = await requireDynamicSupabaseAdmin().rpc("price_alert_settle_delivery", { p_user_id: userId, p_event_id: eventId, p_attempt: attempt, p_state: state } as never);
    if (error) throw error;
    if (data !== true) throw new Error("Price alert claim was lost");
  },
  async backlog() {
    const { data, error } = await requireDynamicSupabaseAdmin().rpc("price_alert_delivery_backlog", {} as never);
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : null;
    if (!row || typeof row !== "object") throw new Error("Price alert backlog unavailable");
    const result = row as { failed: number; retryable: number; uncertain: number; oldest_pending: string | null };
    return { failed: Number(result.failed), retryable: Number(result.retryable), uncertain: Number(result.uncertain), oldestPending: result.oldest_pending };
  },
  async activatePending(version, lease, limit) {
    const { data, error } = await requireDynamicSupabaseAdmin().rpc("price_alert_activate_pending", { p_version: version, p_lease: lease, p_limit: limit } as never);
    if (error) throw error;
    return Number(data);
  },
  async retryPage(afterUser, afterEvent, limit) {
    const { data, error } = await requireDynamicSupabaseAdmin().rpc("price_alert_retry_page", { p_after_user: afterUser, p_after_event: afterEvent, p_limit: limit } as never);
    if (error) throw error;
    type Row = { user_id: string; area: string; threshold_pence: number; token: string; enabled_at: string; event_payload: PriceAlertEvent; recorded_at: string };
    return ((data ?? []) as Row[]).map((row) => ({ recipient: { userId: row.user_id, area: row.area, thresholdPence: row.threshold_pence, token: row.token, enabledAt: row.enabled_at, enabled: true as const }, event: row.event_payload, recordedAt: row.recorded_at }));
  },
  async dismissRetry(userId, eventId) {
    const { error } = await requireDynamicSupabaseAdmin().rpc("dismiss_price_alert_retry", { p_user_id: userId, p_event_id: eventId } as never);
    if (error) throw error;
  },
};

export function priceAlertStore(): Store {
  return selectStore(memory, durable);
}
