import type { DrinkCategory } from "@/lib/drinks";
import { isDrinkCategory } from "@/lib/drinks";
import { priceStandingFor } from "@/lib/priceTier";

export const PUB_COMPARISON_MAX_VENUES = 3;
export const PUB_COMPARISON_MAX_LINES = 10;
export const PUB_COMPARISON_MAX_QUANTITY = 12;
const DRINK_LABEL_MAX = 160;
const SERVING_MAX = 40;

export type PubComparisonOrderLine = {
  category: DrinkCategory;
  drinkLabel: string;
  serving: string;
  quantity: number;
};
export type PubComparisonRequest = {
  venueIds: string[];
  order: PubComparisonOrderLine[];
  meetingPointId?: string;
};
export type PubComparisonEvidence = {
  category: DrinkCategory;
  drinkLabel: string;
  serving: string | null;
  pricePence: number;
  sourceClass: "listed";
  sourceKind: "directory" | "site-harvest" | "drink-price-update" | "listing-site";
  sourceUrl: string | null;
  publisher: string | null;
  date: string | null;
  dateMeaning: "source-read";
  eligible: boolean;
};
type PubComparisonVenue = {
  id: string;
  name: string;
  address: string | null;
  borough: string;
};
export type PubComparisonWalk = {
  status: "routed" | "unavailable" | "not-requested";
  minutes: number | null;
  method: "ors" | null;
  /** All durations use the same walking pace over the routed street length. */
  timing: "shared-walking-pace" | null;
};
export type PubComparisonVenueInput = PubComparisonVenue & {
  evidence: PubComparisonEvidence[];
  mapHref: string;
  readUnavailable?: boolean;
};
type PubComparisonItem = {
  requested: PubComparisonOrderLine;
  status: "matched" | "missing";
  evidence: PubComparisonEvidence | null;
  reason: string | null;
  lineTotalPence: number | null;
};
export type PubComparisonResultVenue = PubComparisonVenue & {
  items: PubComparisonItem[];
  knownSubtotalPence: number;
  totalPence: number | null;
  walk: PubComparisonWalk;
  mapHref: string;
};
export type PubComparisonResponse = {
  status: "ready";
  venues: PubComparisonResultVenue[];
  completeVenueCount: number;
  meetingPoint: { id: string; name: string } | null;
};
export type PubComparisonDrink = Pick<PubComparisonOrderLine, "category" | "drinkLabel" | "serving"> & { key: string };
export type PubComparisonCatalogue = {
  status: "ready";
  venues: PubComparisonVenue[];
  drinks: PubComparisonDrink[];
  meetingPoints: { id: string; name: string }[];
  coverage: "ready" | "partial";
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function text(value: unknown, max: number): string | null {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f<>]/.test(value)) return null;
  return value.trim().replace(/\s+/g, " ");
}
function comparisonTextKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB");
}

export function parseComparisonVenueIds(value: unknown, allowEmpty = false): string[] | null {
  if (!Array.isArray(value) || value.length > PUB_COMPARISON_MAX_VENUES || (!allowEmpty && value.length === 0)) return null;
  const ids: string[] = [];
  for (const id of value) {
    if (typeof id !== "string" || !/^[A-Za-z0-9:_-]{1,128}$/.test(id) || ids.includes(id)) return null;
    ids.push(id);
  }
  return ids;
}

export function parsePubComparisonRequest(value: unknown): PubComparisonRequest | null {
  if (!record(value) || !onlyKeys(value, ["venueIds", "order", "meetingPointId"])) return null;
  const venueIds = parseComparisonVenueIds(value.venueIds);
  if (!venueIds || !Array.isArray(value.order) || value.order.length < 1 || value.order.length > PUB_COMPARISON_MAX_LINES) return null;
  const order: PubComparisonOrderLine[] = [];
  const identities = new Set<string>();
  for (const raw of value.order) {
    if (!record(raw) || !onlyKeys(raw, ["category", "drinkLabel", "serving", "quantity"]) || !isDrinkCategory(raw.category)) return null;
    const drinkLabel = text(raw.drinkLabel, DRINK_LABEL_MAX);
    const serving = text(raw.serving, SERVING_MAX);
    if (!drinkLabel || !serving || !Number.isInteger(raw.quantity) || (raw.quantity as number) < 1 || (raw.quantity as number) > PUB_COMPARISON_MAX_QUANTITY) return null;
    const key = comparisonDrinkKey({ category: raw.category, drinkLabel, serving });
    if (identities.has(key)) return null;
    identities.add(key);
    order.push({ category: raw.category, drinkLabel, serving, quantity: raw.quantity as number });
  }
  if (value.meetingPointId !== undefined && (typeof value.meetingPointId !== "string" || !/^[a-z0-9-]{1,80}$/.test(value.meetingPointId))) return null;
  return { venueIds, order, ...(typeof value.meetingPointId === "string" ? { meetingPointId: value.meetingPointId } : {}) };
}

export function comparisonDrinkKey(drink: Pick<PubComparisonOrderLine, "category" | "drinkLabel" | "serving">): string {
  return JSON.stringify([drink.category, comparisonTextKey(drink.drinkLabel), comparisonTextKey(drink.serving)]);
}

/** A label without a volume must not equate different bottles or glasses. */
function comparisonServingIsExplicit(serving: string | null): serving is string {
  if (!serving) return false;
  const key = comparisonTextKey(serving);
  return /^(?:pint|half|half pint|single espresso|double espresso)$/.test(key)
    || /^(?:\d+(?:\.\d+)?\s*(?:ml|cl|l|oz))(?:\s+(?:bottle|can|glass|cup))?$/.test(key);
}

export function comparisonEvidenceEligible(evidence: PubComparisonEvidence, now: number): boolean {
  if (!comparisonServingIsExplicit(evidence.serving) || !evidence.sourceUrl || !evidence.date
    || !Number.isSafeInteger(evidence.pricePence) || evidence.pricePence <= 0 || evidence.pricePence > 100_000) return false;
  try {
    const url = new URL(evidence.sourceUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return false;
  } catch { return false; }
  return priceStandingFor({ listed: {
    priceGbp: evidence.pricePence / 100,
    sourceUrl: evidence.sourceUrl,
    observedAt: evidence.date,
  } }, now).standing === "listed";
}

function compareItem(requested: PubComparisonOrderLine, venue: PubComparisonVenueInput, now: number): PubComparisonItem {
  const sameDrink = venue.evidence.filter((row) => row.category === requested.category
    && comparisonTextKey(row.drinkLabel) === comparisonTextKey(requested.drinkLabel));
  const exact = sameDrink.filter((row) => row.serving !== null
    && comparisonTextKey(row.serving) === comparisonTextKey(requested.serving))
    .map((row) => ({ ...row, eligible: comparisonEvidenceEligible(row, now) }))
    .sort((a, b) => Number(b.eligible) - Number(a.eligible)
      || (Date.parse(b.date ?? "") || 0) - (Date.parse(a.date ?? "") || 0)
      || a.pricePence - b.pricePence);
  const evidence = exact[0] ?? null;
  if (evidence?.eligible) return { requested, status: "matched", evidence, reason: null, lineTotalPence: evidence.pricePence * requested.quantity };
  let reason = "This drink is not recorded for this pub.";
  if (venue.readUnavailable) reason = "Some price records could not be read.";
  else if (sameDrink.length && !exact.length) reason = sameDrink.every((row) => !row.serving)
    ? "Serving size is not recorded." : "Serving size does not match.";
  else if (evidence) {
    if (!comparisonServingIsExplicit(evidence.serving)) reason = "The serving label does not state a comparable size.";
    else if (!evidence.sourceUrl) reason = "A source link is not recorded.";
    else if (!evidence.date) reason = "The source read date is not recorded.";
    else reason = "This dated price no longer qualifies for comparison.";
  }
  return { requested, status: "missing", evidence, reason, lineTotalPence: null };
}

/** Compare the requested order. Input order is retained, including incomplete pubs. */
export function comparePubOrders(request: PubComparisonRequest, venues: readonly PubComparisonVenueInput[], now: number): PubComparisonResponse {
  const results = request.venueIds.map((id) => {
    const venue = venues.find((candidate) => candidate.id === id);
    if (!venue) throw new Error("Unknown comparison venue");
    const items = request.order.map((line) => compareItem(line, venue, now));
    const knownSubtotalPence = items.reduce((sum, line) => sum + (line.lineTotalPence ?? 0), 0);
    return {
      id: venue.id, name: venue.name, address: venue.address, borough: venue.borough,
      items, knownSubtotalPence,
      totalPence: items.every((line) => line.status === "matched") ? knownSubtotalPence : null,
      walk: { status: "not-requested", minutes: null, method: null, timing: null } as PubComparisonWalk,
      mapHref: venue.mapHref,
    };
  });
  return { status: "ready", venues: results, completeVenueCount: results.filter((venue) => venue.totalPence !== null).length, meetingPoint: null };
}

export function comparisonCatalogueDrinks(venues: readonly PubComparisonVenueInput[]): PubComparisonDrink[] {
  const drinks = new Map<string, PubComparisonDrink>();
  for (const venue of venues) for (const row of venue.evidence) {
    if (!text(row.drinkLabel, DRINK_LABEL_MAX) || !text(row.serving, SERVING_MAX)
      || !comparisonServingIsExplicit(row.serving)) continue;
    const drink = { category: row.category, drinkLabel: row.drinkLabel, serving: row.serving };
    const key = comparisonDrinkKey(drink);
    if (!drinks.has(key)) drinks.set(key, { ...drink, key });
  }
  return [...drinks.values()].sort((a, b) => a.category.localeCompare(b.category) || a.drinkLabel.localeCompare(b.drinkLabel) || a.serving.localeCompare(b.serving));
}
