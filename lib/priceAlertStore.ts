import "server-only";

import { admin, selectStore } from "@/lib/storeBackend";
import { matchesPriceAlert, type PriceAlertObservation } from "@/lib/priceAlert";
import { NIGHT_AREA_SLUGS } from "@/lib/nightAreaSlugs";

type Setting = { area: string; thresholdPence: number; token: string };
type Recipient = Setting & { userId: string; enabled: true };
type Store = {
  get(userId: string): Promise<Setting | null>;
  save(userId: string, setting: Setting): Promise<void>;
  remove(userId: string): Promise<void>;
  removeIfToken(userId: string, token: string): Promise<void>;
  list(observation: PriceAlertObservation): Promise<Recipient[]>;
  claim(userId: string, eventId: string, setting: Setting): Promise<boolean>;
};

const preferences = new Map<string, Setting>();
const claims = new Set<string>();

export function __resetPriceAlertStore(): void {
  preferences.clear();
  claims.clear();
}

const memory: Store = {
  async get(userId) { return preferences.get(userId) ?? null; },
  async save(userId, setting) {
    for (const [owner, current] of preferences) {
      if (owner !== userId && current.token === setting.token) preferences.delete(owner);
    }
    preferences.set(userId, { ...setting });
  },
  async remove(userId) { preferences.delete(userId); },
  async removeIfToken(userId, token) { if (preferences.get(userId)?.token === token) preferences.delete(userId); },
  async list(observation) { return [...preferences].map(([userId, setting]) => ({ userId, ...setting, enabled: true as const })).filter((setting) => matchesPriceAlert(setting, observation)); },
  async claim(userId, eventId, setting) {
    const current = preferences.get(userId);
    if (!current || current.token !== setting.token || current.area !== setting.area || current.thresholdPence !== setting.thresholdPence) return false;
    const key = JSON.stringify([userId, eventId]);
    if (claims.has(key)) return false;
    claims.add(key);
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
    const areas = NIGHT_AREA_SLUGS.filter((area) => matchesPriceAlert({ area, thresholdPence: observation.pricePence + 1, enabled: true }, observation));
    if (!areas.length) return rows;
    let after = "";
    for (;;) {
      let query = admin().from("price_alert_preferences").select("user_id, area, threshold_pence, token").in("area", areas).gt("threshold_pence", observation.pricePence).order("user_id").limit(pageSize);
      if (after) query = query.gt("user_id", after);
      const { data, error } = await query;
      if (error) throw error;
      rows.push(...(data ?? []).map((row) => ({ userId: String(row.user_id), area: String(row.area), thresholdPence: Number(row.threshold_pence), token: String(row.token), enabled: true as const })));
      if (!data || data.length < pageSize) return rows;
      const last = data.at(-1);
      if (!last) return rows;
      after = String(last.user_id);
    }
  },
  async claim(userId, eventId, setting) {
    const { data, error } = await admin().rpc("price_alert_claim", { p_user_id: userId, p_event_id: eventId, p_token: setting.token, p_area: setting.area, p_threshold_pence: setting.thresholdPence });
    if (error) throw error;
    return data === true;
  },
};

export function priceAlertStore(): Store {
  return selectStore(memory, durable);
}
