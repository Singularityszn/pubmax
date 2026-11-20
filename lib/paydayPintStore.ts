import "server-only";
import { randomUUID } from "node:crypto";
import { selectStore } from "@/lib/storeBackend";
import { requireSupabaseAdmin as admin } from "@/lib/supabase";

const CONFIRMATION_LIFETIME_MS = 48 * 60 * 60 * 1000;
type PaydayRequest = { email: string; station: string; consentText: string; confirmationHash: string; unsubscribeToken: string; createdAt: string };
type PaydaySubscriber = { id: string; email: string; station: string; consentAt: string; confirmedAt: string; unsubscribeToken: string; unsubscribedAt: string | null; lastClaimedWeek: string | null };
export type PaydayStore = {
  request(input: PaydayRequest): Promise<void>;
  confirm(hash: string, now: string): Promise<boolean>;
  unsubscribe(token: string, now: string): Promise<void>;
  active(): Promise<PaydaySubscriber[]>;
  claim(id: string, week: string): Promise<boolean>;
  isActive(id: string, token: string, consentAt: string): Promise<boolean>;
};

export function createMemoryPaydayStore(): PaydayStore {
  const pending = new Map<string, PaydayRequest>();
  const subscribers = new Map<string, PaydaySubscriber>();
  return {
    async request(input) {
      for (const [hash, item] of pending) if (Date.parse(item.createdAt) + CONFIRMATION_LIFETIME_MS < Date.parse(input.createdAt)) pending.delete(hash);
      pending.set(input.confirmationHash, input);
    },
    async confirm(hash, now) {
      const item = pending.get(hash);
      if (!item || Date.parse(now) > Date.parse(item.createdAt) + CONFIRMATION_LIFETIME_MS) return false;
      pending.delete(hash);
      const previous = subscribers.get(item.email);
      if (previous && (previous.consentAt >= item.createdAt || (previous.unsubscribedAt && previous.unsubscribedAt >= item.createdAt))) return false;
      subscribers.set(item.email, { id: previous?.id ?? randomUUID(), email: item.email, station: item.station, consentAt: item.createdAt, confirmedAt: now, unsubscribeToken: previous?.unsubscribeToken ?? item.unsubscribeToken, unsubscribedAt: null, lastClaimedWeek: previous?.lastClaimedWeek ?? null });
      return true;
    },
    async unsubscribe(token, now) {
      for (const item of subscribers.values()) if (item.unsubscribeToken === token && (!item.unsubscribedAt || Date.parse(item.unsubscribedAt) < Date.parse(now))) item.unsubscribedAt = now;
    },
    async active() { return [...subscribers.values()].filter((item) => !item.unsubscribedAt).map((item) => ({ ...item })); },
    async isActive(id, token, consentAt) { return [...subscribers.values()].some((item) => item.id === id && item.unsubscribeToken === token && item.consentAt === consentAt && !item.unsubscribedAt); },
    async claim(id, week) {
      const item = [...subscribers.values()].find((subscriber) => subscriber.id === id);
      if (!item || item.unsubscribedAt || item.lastClaimedWeek === week) return false;
      item.lastClaimedWeek = week;
      return true;
    },
  };
}

const memoryGlobal = globalThis as typeof globalThis & {
  __pubmaxPaydayPintStore?: PaydayStore;
};
const memory = memoryGlobal.__pubmaxPaydayPintStore ??= createMemoryPaydayStore();
const durable: PaydayStore = {
  async request(input) {
    const cleanup = await admin().from("payday_pint_pending").delete().lt("expires_at", input.createdAt);
    if (cleanup.error) throw cleanup.error;
    const { error } = await admin().from("payday_pint_pending").insert({ confirmation_hash: input.confirmationHash, email: input.email, station: input.station, consent_text: input.consentText, consent_at: input.createdAt, expires_at: new Date(Date.parse(input.createdAt) + CONFIRMATION_LIFETIME_MS).toISOString(), unsubscribe_token: input.unsubscribeToken });
    if (error) throw error;
  },
  async confirm(hash, now) {
    const { data, error } = await admin().rpc("confirm_payday_pint", { p_hash: hash, p_now: now });
    if (error) throw error;
    return data === true;
  },
  async unsubscribe(token, now) {
    const { error } = await admin().from("payday_pint_subscribers").update({ unsubscribed_at: now }).eq("unsubscribe_token", token).or(`unsubscribed_at.is.null,unsubscribed_at.lt.${now}`);
    if (error) throw error;
  },
  async active() {
    const rows: PaydaySubscriber[] = [];
    let lastId: string | null = null;
    for (;;) {
      let query = admin().from("payday_pint_subscribers").select("id,email,station,consent_at,confirmed_at,unsubscribe_token,unsubscribed_at,last_claimed_week").is("unsubscribed_at", null).order("id").limit(500);
      if (lastId) query = query.gt("id", lastId);
      const { data, error } = await query;
      if (error) throw error;
      rows.push(...(data ?? []).map((item) => ({ id: item.id, email: item.email, station: item.station, consentAt: item.consent_at, confirmedAt: item.confirmed_at, unsubscribeToken: item.unsubscribe_token, unsubscribedAt: item.unsubscribed_at, lastClaimedWeek: item.last_claimed_week })));
      if (!data || data.length < 500) return rows;
      lastId = data[data.length - 1]!.id;
    }
  },
  async isActive(id, token, consentAt) {
    const { data, error } = await admin().from("payday_pint_subscribers").select("id").eq("id", id).eq("unsubscribe_token", token).eq("consent_at", consentAt).is("unsubscribed_at", null).maybeSingle();
    if (error) throw error;
    return data !== null;
  },
  async claim(id, week) {
    const { data, error } = await admin().from("payday_pint_subscribers").update({ last_claimed_week: week }).eq("id", id).is("unsubscribed_at", null).or(`last_claimed_week.is.null,last_claimed_week.neq.${week}`).select("id");
    if (error) throw error;
    return (data?.length ?? 0) === 1;
  },
};
export function paydayPintStore(): PaydayStore { return selectStore(memory, durable); }
