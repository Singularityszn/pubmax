import type { Drink } from "@/lib/drinks";
import { isDemoDrinkProvenance } from "@/lib/drinks";
import type { FoodItem } from "@/lib/food";
import { firstHttp } from "@/lib/httpUrl";
import { outingItemSchema, quoteOuting } from "@/lib/outingQuote";

function pennies(gbp: number): number | null {
  const amount = Math.round(gbp * 100);
  return Number.isFinite(gbp) && amount >= 0 && amount <= 100_000_000 && Math.abs(gbp * 100 - amount) < 0.000001 ? amount : null;
}

function observedInstant(value: string | null): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  // Preserve the recorded date. Normalisation supplies no new observation.
  return new Date(value).toISOString();
}

/** Only menu records already supplied by the venue read. No fetches and no synthetic menu rows. */
export function menuBasketItems(venueId: string, food: readonly FoodItem[], drinks: readonly Drink[]) {
  const common = { venueId, currency: "GBP" as const, taxIncluded: null };
  const rows = [
    ...food.filter((item) => item.provenance.source !== "seed" && !item.provenance.source.toLowerCase().includes("demo")).map((item) => ({
      ...common, id: `food:${item.id}`, name: item.name, kind: "food" as const, serving: null,
      unitPence: pennies(item.priceGbp), evidence: {
        source: item.provenance.source, url: firstHttp(item.source) || null,
        observedAt: observedInstant(item.provenance.observedAt), retrievedAt: null, state: "available" as const,
      },
    })),
    ...drinks.filter((item) => !isDemoDrinkProvenance(item.provenance)).map((item) => ({
      ...common, id: `drink:${item.id}`, name: item.name, kind: "drink" as const, serving: item.servingSize?.trim() || null,
      unitPence: pennies(item.priceGbp), evidence: {
        source: item.provenance.source, url: firstHttp(item.provenance.sourceUrl) || null,
        observedAt: observedInstant(item.provenance.observedAt), retrievedAt: null, state: "available" as const,
      },
    })),
  ];
  return rows.flatMap((row) => {
    const parsed = outingItemSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Legacy menus do not state complete fees, deposits, tax or availability. They can supply a subtotal only. */
export function quoteMenuBasket(venueId: string, items: ReturnType<typeof menuBasketItems>, quantities: Readonly<Record<string, number>>, now: string) {
  return quoteOuting({
    venueId, arrival: now, partySize: 1, membership: "unknown", bookingConfirmed: null, availabilityConfirmed: null,
    items: items.filter((item) => (quantities[item.id] ?? 0) > 0).map((item) => ({ item, quantity: quantities[item.id] })),
    charges: null, deposits: null, optionalTipPence: 0,
  }, [], now);
}
