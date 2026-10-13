import "server-only";

import { lookupVenueDetail } from "@/lib/venueDetailIndex";
import { venueMenuForInspector, venueMenuLookupKeys } from "@/lib/venueMenu";
import { venueFoodMenuForInspector } from "@/lib/venueFoodMenu";
import { venuePriceUpdatesFor } from "@/lib/priceUpdates.server";
import { isDemoDrinkProvenance, type DrinkCategory } from "@/lib/drinks";
import { namedMenuRequest } from "@/lib/ask/router";
import type { AskCard, AskMenuEvidence } from "@/lib/ask/types";
import { formatGbp } from "@/lib/formatGbp";

function words(value: string): string {
  return value.toLocaleLowerCase("en-GB").replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export async function publishedMenuCards(venueId: string, query: string, category?: DrinkCategory): Promise<{ cards: AskCard[]; unavailable: boolean }> {
  const lookup = await lookupVenueDetail(venueId);
  if (lookup.status !== "found") return { cards: [], unavailable: lookup.status === "unavailable" };
  const venue = lookup.venue;
  const updates = await venuePriceUpdatesFor(venueMenuLookupKeys(venue));
  if (!updates) return { cards: [], unavailable: true };
  const request = namedMenuRequest(query);
  const subject = request?.subject ?? "drinks";
  const serving = subject.match(/\b\d+\s*ml\b|\b(?:pint|glass|bottle|double|single)\b/i)?.[0];
  const dietary = subject.match(/\b(?:vegan|vegetarian|gluten[- ]free)\b/i)?.[0]?.toLowerCase().replace(" ", "-");
  const foodOnly = /\b(?:food|meals?|lunch|dinner|breakfast|calories|kcal|dietary|vegan|vegetarian|gluten[- ]free)\b/i.test(subject);
  const allItems = /\bmenu\b/i.test(subject) && !foodOnly && !/\bdrinks?\b/i.test(subject);
  const itemQuery = category ? "" : words(subject
    .replace(/\b\d+\s*ml\b|\b(?:pint|glass|bottle|double|single)\b/gi, " ")
    .replace(/\b(?:right now|this evening|this afternoon|this morning|this weekend|tonight|now|later|today)\b/gi, " ")
    .replace(/\b(?:what|which|is|are|does|do|the|a|an|and|or|of|for|its|it|their|they|have|has|how|much|price|prices|cost|costs|published|recorded|calorie|calories|kcal|dietary|vegan|vegetarian|gluten[- ]free|options?|food|meals?|drinks?|menu|servings?|please|show|me|tell)\b/gi, " "));
  const matches = (name: string) => !itemQuery || itemQuery.split(" ").every((token) => words(name).split(" ").includes(token));
  const cards: AskCard[] = [];
  const add = (evidence: AskMenuEvidence, price: number) => {
    if (!matches(evidence.itemName)) return;
    if (serving && (!evidence.serving || !words(evidence.serving).includes(words(serving)))) return;
    if (dietary && !itemQuery && !evidence.dietary.includes(dietary as "vegan" | "vegetarian" | "gluten-free")) return;
    const calories = evidence.caloriesKcal === null ? "Published calories not recorded." : `${evidence.caloriesKcal} kcal published for this item.`;
    const tags = evidence.dietary.length ? `Publisher labels: ${evidence.dietary.join(", ")}.` : "Dietary labels not recorded.";
    const dates = [
      evidence.observedAt ? `Price observed ${evidence.observedAt.slice(0, 10)}.` : "Price observation date unknown.",
      evidence.caloriesProvenance ? `Calories from ${evidence.caloriesProvenance.source}, observed ${evidence.caloriesProvenance.observedAt.slice(0, 10)}.` : null,
      evidence.dietaryProvenance ? `Dietary labels from ${evidence.dietaryProvenance.source}, observed ${evidence.dietaryProvenance.observedAt.slice(0, 10)}.` : null,
    ].filter(Boolean).join(" ");
    cards.push({
      key: `${venue.id}:menu:${evidence.itemId}`, venueId: venue.id,
      title: `${evidence.itemName} at ${venue.name}`, place: venue.address,
      note: `${evidence.serving ? `Published serving: ${evidence.serving}.` : "Serving size not recorded."} ${calories} ${tags} ${dates} Availability unknown.`,
      price, menuEvidence: evidence,
      provenance: { label: evidence.source, kind: "published-menu", ...(evidence.sourceUrl ? { url: evidence.sourceUrl } : {}) },
    });
  };
  if (!category && (foodOnly || allItems || itemQuery)) {
    for (const item of venueFoodMenuForInspector(venue, updates.food)) {
      add({ kind: "published-menu", itemId: item.id, itemName: item.name, menu: "food", category: item.category,
        currency: "GBP", serving: null, caloriesKcal: item.caloriesKcal ?? null,
        caloriesProvenance: item.caloriesProvenance ?? null, dietary: item.dietary ?? [], dietaryProvenance: item.dietaryProvenance ?? null,
        observedAt: item.provenance.observedAt, source: item.provenance.source, sourceUrl: item.source ?? null,
        licence: item.provenance.licence, availability: "unknown" }, item.priceGbp);
    }
  }
  if (!foodOnly || itemQuery || allItems) {
    for (const item of venueMenuForInspector(venue, updates.drink)) {
      if (isDemoDrinkProvenance(item.provenance) || (category && item.category !== category)) continue;
      add({ kind: "published-menu", itemId: item.id, itemName: item.name, menu: "drink", category: item.category,
        currency: "GBP", serving: item.servingSize ?? null, caloriesKcal: null,
        caloriesProvenance: null, dietary: [], dietaryProvenance: null,
        observedAt: item.provenance.observedAt, source: item.provenance.source, sourceUrl: item.provenance.sourceUrl ?? null,
        licence: item.provenance.licence, availability: "unknown" }, item.priceGbp);
    }
  }
  return { cards: cards.slice(0, 8), unavailable: false };
}

export function publishedMenuAnswer(cards: AskCard[]): string {
  return cards.map((card) => `${card.title}: ${card.price === null ? "Price not recorded" : formatGbp(card.price)}. ${card.note}`).join(" ");
}
