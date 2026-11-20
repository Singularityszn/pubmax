import "server-only";

import { randomUUID } from "node:crypto";
import { validateDealPrice, type DealPrice, type DealPriceInput } from "@/lib/dealPrice";
import { dealIsVisible } from "@/lib/dealSchedule";
import { londonDayKey } from "@/lib/londonHour";
import { admin, selectStore } from "@/lib/storeBackend";

type Write = DealPriceInput & { actor: string };
type Stored = DealPrice & { actor: string; hidden: boolean; reviewedAt: string | null; revision: string };
type Store = {
  submit(input: Write): Promise<{ deal: DealPrice; hidden: boolean }>;
  read(venueId?: string): Promise<DealPrice[]>;
  report(id: string, actor: string): Promise<boolean>;
  review(): Promise<Array<DealPrice & { hidden: boolean; revision: string }>>;
  moderate(id: string, hidden: boolean, expectedRevision: string): Promise<boolean>;
};

const MAX_DEAL_ROWS = 10_000;
const PAGE_SIZE = 1_000;
const memoryRows = new Map<string, Stored>();
const memoryReports = new Map<string, string>();

function publicDeal(row: Stored): DealPrice {
  return { id: row.id, venueId: row.venueId, drinkCategory: row.drinkCategory, drink: row.drink, measure: row.measure, measureLabel: row.measureLabel, priceGbp: row.priceGbp, schedule: row.schedule, endDate: row.endDate, conditions: row.conditions, reportedAt: row.reportedAt };
}

function keyOf(input: Write): string {
  return JSON.stringify([input.venueId, input.drinkCategory, input.drink, input.measure, input.measureLabel, input.actor]);
}

export const memoryDealPriceStore: Store = {
  async submit(input) {
    const key = keyOf(input);
    const old = memoryRows.get(key);
    const row: Stored = { ...input, id: old?.id ?? randomUUID(), reportedAt: new Date().toISOString(), hidden: old?.hidden ?? false, reviewedAt: old?.reviewedAt ?? null, revision: randomUUID() };
    memoryRows.set(key, row);
    return { deal: publicDeal(row), hidden: row.hidden };
  },
  async read(venueId) {
    const now = Date.now();
    const rows = [...memoryRows.values()].filter((row) => !row.hidden && (!venueId || row.venueId === venueId))
      .filter((row) => venueId || row.endDate !== null || Date.parse(row.reportedAt) >= now - 30 * 24 * 60 * 60 * 1000);
    if (rows.length > MAX_DEAL_ROWS) throw new Error("Deal read exceeds the supported limit.");
    return rows.filter((row) => dealIsVisible(row, new Date())).map(publicDeal);
  },
  async report(id, actor) {
    const row = [...memoryRows.values()].find((candidate) => candidate.id === id);
    if (!row) return false;
    const key = JSON.stringify([id, actor]);
    const previous = memoryReports.get(key);
    if (!previous || (row.reviewedAt && previous <= row.reviewedAt)) memoryReports.set(key, new Date(Math.max(Date.now(), row.reviewedAt ? Date.parse(row.reviewedAt) + 1 : 0)).toISOString());
    return true;
  },
  async review() {
    return [...memoryRows.values()].filter((row) => row.hidden || [...memoryReports].some(([key, at]) => (JSON.parse(key) as string[])[0] === row.id && (!row.reviewedAt || at > row.reviewedAt))).map((row) => ({ ...publicDeal(row), hidden: row.hidden, revision: row.revision }));
  },
  async moderate(id, hidden, expectedRevision) {
    const row = [...memoryRows.values()].find((candidate) => candidate.id === id);
    if (!row || row.revision !== expectedRevision) return false;
    row.hidden = hidden;
    row.reviewedAt = new Date().toISOString();
    row.revision = randomUUID();
    return true;
  },
};

function fromRow(row: Record<string, unknown>): DealPrice {
  const schedule = { days: row.days, start: String(row.starts_at).slice(0, 5), end: String(row.ends_at).slice(0, 5) };
  const parsed = validateDealPrice({
    venueId: row.venue_id, drinkCategory: row.drink_category, drink: row.drink,
    measure: row.measure, measureLabel: row.measure_label, priceGbp: Number(row.price_pennies) / 100,
    schedule, endDate: row.end_date, conditions: row.conditions,
  });
  if (!parsed.ok || typeof row.id !== "string" || typeof row.submitted_at !== "string") throw new Error("Invalid stored deal.");
  return { ...parsed.value, id: row.id, reportedAt: row.submitted_at };
}

const durableDealPriceStore: Store = {
  async submit(input) {
    const { data, error } = await admin().from("deal_prices").upsert({
      venue_id: input.venueId, drink_category: input.drinkCategory, drink: input.drink,
      measure: input.measure, measure_label: input.measureLabel, price_pennies: Math.round(input.priceGbp * 100),
      days: input.schedule.days, starts_at: input.schedule.start, ends_at: input.schedule.end,
      end_date: input.endDate, conditions: input.conditions, actor: input.actor, submitted_at: new Date().toISOString(), revision: randomUUID(),
    }, { onConflict: "venue_id,drink_category,drink,measure,measure_label,actor" }).select().single();
    if (error || !data) throw new Error("Could not save the deal.");
    return { deal: fromRow(data), hidden: data.hidden === true };
  },
  async read(venueId) {
    const rows: DealPrice[] = [];
    const now = new Date();
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    for (let offset = 0; offset <= MAX_DEAL_ROWS; offset += PAGE_SIZE) {
      let query = admin().from("deal_prices").select("id,venue_id,drink_category,drink,measure,measure_label,price_pennies,days,starts_at,ends_at,end_date,conditions,submitted_at")
        .eq("hidden", false).order("submitted_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + PAGE_SIZE - 1);
      if (venueId) query = query.eq("venue_id", venueId);
      else query = query.or(`end_date.gte.${londonDayKey(now)},and(end_date.is.null,submitted_at.gte.${cutoff})`);
      const { data, error } = await query;
      if (error || !data) throw new Error("Could not load deals.");
      if (offset === MAX_DEAL_ROWS && data.length) throw new Error("Deal read exceeds the supported limit.");
      rows.push(...data.map(fromRow));
      if (data.length < PAGE_SIZE) return rows.filter((row) => dealIsVisible(row, now));
    }
    return rows.filter((row) => dealIsVisible(row, now));
  },
  async report(id, actor) {
    const { data, error } = await admin().rpc("report_deal_price", { p_id: id, p_actor_hash: actor });
    if (error) throw new Error("Could not report the deal.");
    return data === true;
  },
  async review() {
    const rows: Array<DealPrice & { hidden: boolean; revision: string }> = [];
    const fields = "id,venue_id,drink_category,drink,measure,measure_label,price_pennies,days,starts_at,ends_at,end_date,conditions,submitted_at,hidden,revision";
    for (let offset = 0; offset <= MAX_DEAL_ROWS; offset += PAGE_SIZE) {
      const { data, error } = await admin().rpc("list_deals_for_review").select(fields)
        .order("submitted_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + PAGE_SIZE - 1);
      if (error || !Array.isArray(data) || (offset === MAX_DEAL_ROWS && data.length)) throw new Error("Could not load reported deals.");
      rows.push(...data.map((row: Record<string, unknown>) => {
        if (typeof row.revision !== "string") throw new Error("Invalid deal revision.");
        return { ...fromRow(row), hidden: row.hidden === true, revision: row.revision };
      }));
      if (data.length < PAGE_SIZE) return rows;
    }
    return rows;
  },
  async moderate(id, hidden, expectedRevision) {
    const { data, error } = await admin().rpc("moderate_deal_price", { p_id: id, p_revision: expectedRevision, p_hidden: hidden });
    if (error) throw new Error("Could not update deal.");
    return data === true;
  },
};

export function dealPriceStore(): Store {
  return selectStore(memoryDealPriceStore, durableDealPriceStore);
}
