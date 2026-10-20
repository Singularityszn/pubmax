import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PalCardPrice from "@/components/pal/PalCardPrice";
import type { PalCard } from "@/lib/palChat";
import { palChatResultFromBody } from "@/lib/palChatClient";

const card: PalCard = { key: "price", venueId: "venue-e1srzr", title: "Recorded price", place: "Soho", note: "", price: 9, provenance: { kind: "directory", label: "On record" } };
const menuCard = (menu: "food" | "drink", serving: string | null): PalCard => ({ ...card, provenance: { kind: "published-menu", label: "Pub menu" }, menuEvidence: {
  kind: "published-menu", itemId: "item", itemName: "Item", menu, category: menu === "food" ? "meal" : "beer", currency: "GBP", serving,
  caloriesKcal: null, caloriesProvenance: null, dietary: [], dietaryProvenance: null, observedAt: "2026-10-02", source: "Pub menu", sourceUrl: null, licence: "Published menu", availability: "unknown",
} });
const render = (value: PalCard) => renderToStaticMarkup(createElement(PalCardPrice, { card: value }));

describe("the measure on a Pal price", () => {
  it.each([menuCard("food", "portion"), menuCard("drink", "175ml"), menuCard("drink", null), { ...card, provenance: { kind: "community-price", label: "People-logged" } } as PalCard])("does not compare meals, small servings or unmeasured observations with pint prices", (value) => {
    const markup = render(value);
    expect(markup).toContain("£9.00");
    expect(markup).not.toContain('title=');
  });
  it.each([card, menuCard("drink", "pint")])("keeps the comparison for an attested pint", (value) => {
    expect(render(value)).toMatch(/title="(?:Expensive|Average|Cheap):/);
  });
  it("prints no figure when the source has no price", () => {
    expect(render({ ...card, price: null })).toBe("");
  });
});


it("retains community provenance through response normalization before displaying its price", () => {
  const answer = palChatResultFromBody({ answer: "A recorded glass of wine.", cards: [{ ...card, provenance: { kind: "community-price", label: "People-logged" } }] });
  if (answer.status === "error") throw new Error("Expected the recorded card");
  expect(answer.cards[0]?.provenance.kind).toBe("community-price");
  expect(render(answer.cards[0]!)).not.toContain('title=');
});
