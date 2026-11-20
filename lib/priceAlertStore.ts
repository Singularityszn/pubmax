import "server-only";

import { admin, selectStore } from "@/lib/storeBackend";
import { isPriceAlertThreshold, matchesPriceAlert, PRICE_ALERT_THRESHOLD_PENCE, type PriceAlertObservation } from "@/lib/priceAlert";
import { NIGHT_AREA_SLUGS } from "@/lib/nightAreaSlugs";
import { londonDayKey } from "@/lib/londonHour";

type Setting = { area: string; thresholdPence: number; token: string };
type Recipient = Setting & { userId: string; enabled: true; enabledAt: string };
type Store = {
  get(userId: string): Promise<Setting | null>;
  save(userId: string, setting: Setting): Promise<void>;
  remove(userId: string): Promise<void>;
  removeIfToken(userId: string, token: string): Promise<void>;
  list(observation: PriceAlertObservation): Promise<Recipient[]>;
  listAll(): Promise<Recipient[]>;
  claim(userId: string, eventId: string, setting: Setting, recordedAt: string): Promise<boolean>;
};

const preferences = new Map<string, Setting & { enabledAt: string }>();
const claims = new Set<string>();
const dailyClaims = new Set<string>();

export function __resetPriceAlertStore(): void {
  preferences.clear();
  claims.clear();
  dailyClaims.clear();
}

const memory: Store = {
  async get(userId) { return preferences.get(userId) ?? null; },
  async save(userId, setting) {
    if (!isPriceAlertThreshold(setting.thresholdPence)) throw new Error("Invalid price alert threshold");
    for (const [owner, current] of preferences) {
      if (owner !== userId && current.token === setting.token) preferences.delete(owner);
    }
    const previous = preferences.get(userId);
    const enabledAt = previous && previous.area === setting.area
      ? previous.enabledAt : new Date().toISOString();
    preferences.set(userId, { ...setting, enabledAt });
  },
  async remove(userId) { preferences.delete(userId); },
  async removeIfToken(userId, token) { if (preferences.get(userId)?.token === token) preferences.delete(userId); },
  async list(observation) { return [...preferences].map(([userId, setting]) => ({ userId, ...setting, enabled: true as const })).filter((setting) => matchesPriceAlert(setting, observation)); },
  async listAll() { return [...preferences].filter(([userId, setting]) => !dailyClaims.has(JSON.stringify([userId, setting.area, londonDayKey(new Date())]))).map(([userId, setting]) => ({ userId, ...setting, enabled: true as const })); },
  async claim(userId, eventId, setting, recordedAt) {
    const current = preferences.get(userId);
    if (!current || current.token !== setting.token || current.area !== setting.area || current.thresholdPence !== setting.thresholdPence) return false;
    const recorded = Date.parse(recordedAt);
    if (!Number.isFinite(recorded) || recorded <= Date.parse(current.enabledAt) || recorded > Date.now()) return false;
    const key = JSON.stringify([userId, eventId]);
    const day = JSON.stringify([userId, setting.area, londonDayKey(new Date())]);
    if (claims.has(key) || dailyClaims.has(day)) return false;
    claims.add(key);
    dailyClaims.add(day);
    return true;
  },
};

const durable: Store = {
  async get(userId) {
    const { data, error } = await admin().from("price_alert_preferences").select("area, threshold_pence, token").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    return data ? { area: data.area, thresholdPence: data.threshold_pence, token: data.token } : null;
  },
  async save(userId, setting) {
    if (!isPriceAlertThreshold(setting.thresholdPence)) throw new Error("Invalid price alert threshold");
    const { error } = await admin().rpc("price_alert_bind", { p_user_id: userId, p_area: setting.area, p_threshold_pence: setting.thresholdPence, p_token: setting.token });
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
      let query = admin().from("price_alert_preferences").select("user_id, area, threshold_pence, token, enabled_at").in("area", areas).eq("threshold_pence", PRICE_ALERT_THRESHOLD_PENCE).order("user_id").limit(pageSize);
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
  async listAll() {
    const rows: Recipient[] = [];
    let after: string | null = null;
    for (;;) {
      const { data, error }: { data: Array<{ user_id: string; area: string; threshold_pence: number; token: string; enabled_at: string }> | null; error: unknown } = await admin().rpc("price_alert_due", { p_after_user: after, p_limit: 500 });
      if (error) throw error;
      rows.push(...(data ?? []).map((row) => ({ userId: String(row.user_id), area: String(row.area), thresholdPence: Number(row.threshold_pence), token: String(row.token), enabledAt: String(row.enabled_at), enabled: true as const })));
      if (!data || data.length < 500) return rows;
      const last = data.at(-1);
      if (!last) return rows;
      after = String(last.user_id);
    }
  },
  async claim(userId, eventId, setting, recordedAt) {
    const { data, error } = await admin().rpc("price_alert_claim", { p_user_id: userId, p_event_id: eventId, p_token: setting.token, p_area: setting.area, p_threshold_pence: setting.thresholdPence, p_recorded_at: recordedAt });
    if (error) throw error;
    return data === true;
  },
};

export function priceAlertStore(): Store {
  return selectStore(memory, durable);
}
