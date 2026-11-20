import "server-only";

import { randomUUID } from "node:crypto";
import { validateDealPrice, type DealPrice, type DealPriceInput } from "@/lib/dealPrice";
import { dealIsVisible, parseDealSchedule } from "@/lib/dealSchedule";
import { pintDropAuthorityKey } from "@/lib/pintDropAuthority.server";
import { loadVenueAliasResolver } from "@/lib/venueAliases";
import { admin, selectStore } from "@/lib/storeBackend";

type Write = DealPriceInput & { accountId: string };
type AttributedWrite = DealPriceInput & { actor: string };
export type OwnedDealPrice = DealPrice & { hidden: boolean };
type Stored = DealPrice & { actor: string; hidden: boolean; reviewedAt: string | null; revision: string };
type Store = {
  submit(input: Write): Promise<{ deal: DealPrice; hidden: boolean }>;
  read(venueId: string): Promise<DealPrice[]>;
  listForAccount(accountId: string, limit: number): Promise<OwnedDealPrice[]>;
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

function keyOf(input: AttributedWrite): string {
  return JSON.stringify([input.venueId, input.drinkCategory, input.drink, input.measure, input.measureLabel, input.actor, input.schedule.days, input.schedule.start, input.schedule.end]);
}

async function submissionKeys(input: Write): Promise<[AttributedWrite, ...AttributedWrite[]]> {
  const aliases = await loadVenueAliasResolver();
  if (aliases.status !== "ready") throw new Error("Could not resolve the deal venue.");
  const { accountId, ...deal } = input;
  const schedule = parseDealSchedule(deal.schedule);
  if (!schedule) throw new Error("Invalid deal schedule.");
  const keys = aliases.storedIds(input.venueId).map((venueId) => {
    const actor = pintDropAuthorityKey(venueId, accountId);
    if (!actor) throw new Error("Could not identify the deal owner.");
    return { ...deal, schedule, venueId, actor };
  });
  const first = keys[0];
  if (!first) throw new Error("Could not resolve the deal venue.");
  return [first, ...keys.slice(1)];
}

function ownedBy(venueId: string, actor: unknown, accountId: string): boolean {
  const authority = pintDropAuthorityKey(venueId, accountId);
  return Boolean(authority && authority === actor);
}

const memoryDealPriceStore: Store = {
  async submit(input) {
    const keys = await submissionKeys(input);
    const target = keys.find((candidate) => memoryRows.has(keyOf(candidate))) ?? keys[0];
    const key = keyOf(target);
    const old = memoryRows.get(key);
    const row: Stored = { ...target, id: old?.id ?? randomUUID(), reportedAt: new Date().toISOString(), hidden: old?.hidden ?? false, reviewedAt: old?.reviewedAt ?? null, revision: randomUUID() };
    memoryRows.set(key, row);
    return { deal: { ...publicDeal(row), venueId: keys[0].venueId }, hidden: row.hidden };
  },
  async listForAccount(accountId, limit) {
    return [...memoryRows.values()]
      .filter((row) => ownedBy(row.venueId, row.actor, accountId))
      .sort((a, b) => b.reportedAt.localeCompare(a.reportedAt) || b.id.localeCompare(a.id))
      .slice(0, limit).map((row) => ({ ...publicDeal(row), hidden: row.hidden }));
  },
  async read(venueId) {
    const aliases = await loadVenueAliasResolver();
    if (aliases.status !== "ready") throw new Error("Could not resolve the deal venue.");
    const currentId = aliases.canonical(venueId);
    const rows = [...memoryRows.values()].filter((row) => !row.hidden && aliases.canonical(row.venueId) === currentId);
    if (rows.length > MAX_DEAL_ROWS) throw new Error("Deal read exceeds the supported limit.");
    return rows.filter((row) => dealIsVisible(row, new Date())).map((row) => ({ ...publicDeal(row), venueId: currentId }));
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
    const keys = await submissionKeys(input);
    const schedule = keys[0].schedule;
    const { data: existing, error: readError } = await admin().from("deal_prices")
      .select("venue_id,actor")
      .in("venue_id", keys.map((key) => key.venueId))
      .in("actor", keys.map((key) => key.actor))
      .eq("drink_category", input.drinkCategory).eq("drink", input.drink)
      .eq("measure", input.measure).eq("measure_label", input.measureLabel)
      .contains("days", schedule.days).containedBy("days", schedule.days)
      .eq("starts_at", schedule.start).eq("ends_at", schedule.end);
    if (readError || !existing) throw new Error("Could not find the previous deal.");
    const target = keys.find((key) => existing.some((row) => row.venue_id === key.venueId && row.actor === key.actor)) ?? keys[0];
    const { data, error } = await admin().from("deal_prices").upsert({
      venue_id: target.venueId, drink_category: input.drinkCategory, drink: input.drink,
      measure: input.measure, measure_label: input.measureLabel, price_pennies: Math.round(input.priceGbp * 100),
      days: schedule.days, starts_at: schedule.start, ends_at: schedule.end,
      end_date: input.endDate, conditions: input.conditions, actor: target.actor, submitted_at: new Date().toISOString(), revision: randomUUID(),
    }, { onConflict: "venue_id,drink_category,drink,measure,measure_label,actor,days,starts_at,ends_at" }).select().single();
    if (error || !data) throw new Error("Could not save the deal.");
    return { deal: { ...fromRow(data), venueId: keys[0].venueId }, hidden: data.hidden === true };
  },
  async listForAccount(accountId, limit) {
    const owned: OwnedDealPrice[] = [];
    let afterId: string | null = null;
    for (;;) {
      const query = admin().from("deal_prices").select("*").order("id", { ascending: true }).limit(PAGE_SIZE);
      if (afterId) query.gt("id", afterId);
      const { data, error } = await query;
      if (error || !data) throw new Error("Could not export deals.");
      for (const row of data) {
        if (typeof row.venue_id !== "string" || typeof row.actor !== "string") throw new Error("Invalid deal owner.");
        if (ownedBy(row.venue_id, row.actor, accountId)) owned.push({ ...fromRow(row), hidden: row.hidden === true });
        if (owned.length >= limit) return owned;
      }
      if (data.length < PAGE_SIZE) return owned;
      const nextId = data.at(-1)?.id;
      if (typeof nextId !== "string" || (afterId && nextId <= afterId)) throw new Error("Deal export did not advance.");
      afterId = nextId;
    }
  },
  async read(venueId) {
    const rows: DealPrice[] = [];
    const now = new Date();
    const aliases = await loadVenueAliasResolver();
    if (aliases.status !== "ready") throw new Error("Could not resolve the deal venue.");
    const currentId = aliases.canonical(venueId);
    for (let offset = 0; offset <= MAX_DEAL_ROWS; offset += PAGE_SIZE) {
      const query = admin().from("deal_prices").select("id,venue_id,drink_category,drink,measure,measure_label,price_pennies,days,starts_at,ends_at,end_date,conditions,submitted_at")
        .eq("hidden", false).in("venue_id", aliases.storedIds(venueId)).order("submitted_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + PAGE_SIZE - 1);
      const { data, error } = await query;
      if (error || !data) throw new Error("Could not load deals.");
      if (offset === MAX_DEAL_ROWS && data.length) throw new Error("Deal read exceeds the supported limit.");
      rows.push(...data.map((row) => ({ ...fromRow(row), venueId: currentId })));
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
