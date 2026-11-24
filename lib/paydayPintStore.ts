import "server-only";
import { randomUUID } from "node:crypto";
import { selectStore } from "@/lib/storeBackend";
import { requireSupabaseAdmin as admin, requireDynamicSupabaseAdmin } from "@/lib/supabase";
import { PAYDAY_CONFIRMATION_LIFETIME_MS, transitionPaydayConsent, type PaydayConsentState } from "@/lib/paydayPintConsent";
import type { EmailMessage } from "@/lib/emailProvider";

type PaydayRequest = { email: string; station: string; consentText: string; confirmationHash: string; unsubscribeToken: string; createdAt: string };
type PaydaySubscriber = { id: string; email: string; station: string; consentAt: string; confirmedAt: string; unsubscribeToken: string; unsubscribedAt: string | null; lastClaimedWeek: string | null };
type DeliveryRequest = EmailMessage & { from: string; idempotencyKey: string };
export type PaydayStore = {
  request(input: PaydayRequest): Promise<void>;
  confirm(hash: string, now: string): Promise<boolean>;
  unsubscribe(token: string, now: string): Promise<void>;
  active(): Promise<PaydaySubscriber[]>;
  claim(id: string, week: string, claim: string, now: string): Promise<boolean>;
  prepareDelivery(id: string, week: string, claim: string, request: DeliveryRequest | null): Promise<DeliveryRequest | null>;
  finish(id: string, week: string, claim: string, state: "retryable" | "delivered" | "terminal"): Promise<"retryable" | "delivered" | "terminal">;
  isActive(id: string, token: string, consentAt: string): Promise<boolean>;
};

export function createMemoryPaydayStore(): PaydayStore {
  const pending = new Map<string, PaydayRequest>();
  type Subscriber = Omit<PaydaySubscriber, "consentAt" | "confirmedAt" | "unsubscribedAt"> & { consent: Exclude<PaydayConsentState, { phase: "pending" }> };
  const subscribers = new Map<string, Subscriber>();
  const deliveries = new Map<string, { week: string; state: "sending" | "retryable" | "delivered" | "terminal"; attempts: number; claim: string | null; claimedAt: string | null; request: DeliveryRequest | null }>();
  return {
    async request(input) {
      for (const [hash, item] of pending) if (Date.parse(item.createdAt) + PAYDAY_CONFIRMATION_LIFETIME_MS < Date.parse(input.createdAt)) pending.delete(hash);
      pending.set(input.confirmationHash, input);
    },
    async confirm(hash, now) {
      const item = pending.get(hash);
      if (!item) return false;
      pending.delete(hash);
      const previous = subscribers.get(item.email);
      const current: PaydayConsentState = previous?.consent ?? { phase: "pending" };
      const consent = transitionPaydayConsent(current, { type: "confirm", requestedAt: item.createdAt, now });
      if (consent === current || consent.phase !== "confirmed") return false;
      subscribers.set(item.email, { id: previous?.id ?? randomUUID(), email: item.email, station: item.station, consent, unsubscribeToken: previous?.unsubscribeToken ?? item.unsubscribeToken, lastClaimedWeek: previous?.lastClaimedWeek ?? null });
      return true;
    },
    async unsubscribe(token, now) {
      for (const item of subscribers.values()) if (item.unsubscribeToken === token) {
        const consent = transitionPaydayConsent(item.consent, { type: "withdraw", now });
        if (consent.phase === "withdrawn") item.consent = consent;
      }
    },
    async active() { return [...subscribers.values()].filter((item) => item.consent.phase === "confirmed").map(({ consent, ...item }) => ({ ...item, consentAt: consent.consentAt, confirmedAt: consent.confirmedAt, unsubscribedAt: null })); },
    async isActive(id, token, consentAt) { return [...subscribers.values()].some((item) => item.id === id && item.unsubscribeToken === token && item.consent.consentAt === consentAt && item.consent.phase === "confirmed"); },
    async claim(id, week, claim, now) {
      const item = [...subscribers.values()].find((subscriber) => subscriber.id === id);
      if (!item || item.consent.phase !== "confirmed") return false;
      const previous = deliveries.get(id);
      if (previous?.week === week && (previous.attempts >= 3 || (previous.state !== "retryable" && !(previous.state === "sending" && previous.claimedAt && Date.parse(previous.claimedAt) <= Date.parse(now) - 300_000)))) return false;
      if (!previous && item.lastClaimedWeek === week) return false;
      item.lastClaimedWeek = week;
      deliveries.set(id, { week, state: "sending", attempts: previous?.week === week ? previous.attempts + 1 : 1, claim, claimedAt: now, request: previous?.week === week ? previous.request : null });
      return true;
    },
    async prepareDelivery(id, week, claim, request) {
      const delivery = deliveries.get(id);
      if (delivery?.week !== week || delivery.state !== "sending" || delivery.claim !== claim) throw new Error("Payday delivery claim was lost");
      delivery.request ??= structuredClone(request);
      return structuredClone(delivery.request);
    },
    async finish(id, week, claim, state) {
      const delivery = deliveries.get(id);
      if (delivery?.week === week && delivery.state === "sending" && delivery.claim === claim) {
        delivery.state = state === "retryable" && delivery.attempts >= 3 ? "terminal" : state;
        delivery.claim = null;
        delivery.claimedAt = null;
        return delivery.state;
      }
      throw new Error("Payday delivery claim was lost");
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
    const { error } = await admin().from("payday_pint_pending").insert({ confirmation_hash: input.confirmationHash, email: input.email, station: input.station, consent_text: input.consentText, consent_at: input.createdAt, expires_at: new Date(Date.parse(input.createdAt) + PAYDAY_CONFIRMATION_LIFETIME_MS).toISOString(), unsubscribe_token: input.unsubscribeToken });
    if (error) throw error;
  },
  async confirm(hash, now) {
    const { data, error } = await admin().rpc("confirm_payday_pint", { p_hash: hash, p_now: now });
    if (error) throw error;
    return data === true;
  },
  async unsubscribe(token, now) {
    const { error } = await admin().rpc("unsubscribe_payday_pint", { p_token: token, p_now: now });
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
  async claim(id, week, claim, now) {
    const { data, error } = await requireDynamicSupabaseAdmin().rpc("claim_payday_pint_delivery", { p_id: id, p_week: week, p_claim: claim, p_now: now } as never);
    if (error) throw error;
    return data === true;
  },
  async finish(id, week, claim, state) {
    const { data, error } = await requireDynamicSupabaseAdmin().rpc("finish_payday_pint_delivery", { p_id: id, p_week: week, p_claim: claim, p_state: state } as never);
    if (error) throw error;
    if (data !== "retryable" && data !== "delivered" && data !== "terminal") throw new Error("Payday delivery claim was lost");
    return data;
  },
  async prepareDelivery(id, week, claim, request) {
    const { data, error } = await requireDynamicSupabaseAdmin().rpc("prepare_payday_pint_delivery", { p_id: id, p_week: week, p_claim: claim, p_request: request } as never);
    if (error) throw error;
    return data as DeliveryRequest | null;
  },
};
export function paydayPintStore(): PaydayStore { return selectStore(memory, durable); }
