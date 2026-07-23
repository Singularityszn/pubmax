import { describe, expect, it } from "vitest";

import { loadPersonaDrinks } from "@/lib/personaDrinks";
import {
  selectSurpriseDrink,
  type SurpriseDrinkAvailability,
  type SurpriseDrinkInput,
} from "@/lib/surpriseDrink";

const personas = loadPersonaDrinks();
const beer = personas.find((persona) => persona.drinkCategory === "beer")!;
const wine = personas.find((persona) => persona.drinkCategory === "wine")!;
const whisky = personas.find((persona) => persona.drinkCategory === "whisky")!;
const cocktail = personas.find((persona) => persona.drinkCategory === "cocktail")!;
const zeroProof = personas.find((persona) => persona.id === "cristiano-ronaldo")!;

function available(
  personaId: string,
  options: {
    alcoholType?: SurpriseDrinkAvailability["alcoholType"];
    venueId?: string;
    venueName?: string;
    priceGbp?: number;
  } = {},
): SurpriseDrinkAvailability {
  return {
    personaId,
    alcoholType: options.alcoholType ?? "alcoholic",
    venues: [
      {
        venueId: options.venueId ?? `venue-${personaId}`,
        venueName: options.venueName ?? `The ${personaId}`,
        priceGbp: options.priceGbp ?? 6.5,
        source: "Venue menu",
        observedAt: "2026-07-22T18:00:00.000Z",
      },
    ],
  };
}

function input(overrides: Partial<SurpriseDrinkInput> = {}): SurpriseDrinkInput {
  return {
    personKey: "person-123",
    dayKey: "2026-07-22",
    asOfIso: "2026-07-22T20:00:00.000Z",
    anotherIndex: 0,
    availability: [available(beer.id), available(wine.id), available(whisky.id)],
    ...overrides,
  };
}

describe("selectSurpriseDrink", () => {
  it("is deterministic per person/day and ignores availability input order", () => {
    const first = selectSurpriseDrink(input());
    const second = selectSurpriseDrink(input());
    const reordered = selectSurpriseDrink(input({
      availability: [...input().availability].reverse(),
    }));

    expect(first).toEqual(second);
    expect(reordered).toEqual(first);
  });

  it("uses the controlled another index to walk a fixed order without random churn", () => {
    const first = selectSurpriseDrink(input({ anotherIndex: 0 }));
    const another = selectSurpriseDrink(input({ anotherIndex: 1 }));
    const sameAnother = selectSurpriseDrink(input({ anotherIndex: 1 }));
    const wrapped = selectSurpriseDrink(input({ anotherIndex: 3 }));

    expect(first.status).toBe("selected");
    expect(another.status).toBe("selected");
    if (first.status !== "selected" || another.status !== "selected") return;
    expect(another.persona.id).not.toBe(first.persona.id);
    expect(sameAnother).toEqual(another);
    expect(wrapped.status === "selected" && wrapped.persona.id).toBe(first.persona.id);
  });

  it("puts weather-fitting available choices first and explains source, weather and pub evidence", () => {
    const result = selectSurpriseDrink(input({
      weatherVerdict: {
        ruleId: "hard-rain",
        venueLens: "fireplace",
        drinkSuggestion: "a stout",
        line: "Rain's set in. Stout by the fire weather.",
      },
    }));

    expect(result.status).toBe("selected");
    if (result.status !== "selected") return;
    expect(result.persona.id).toBe(beer.id);
    expect(result.rationale.source).toContain(result.persona.sourceName);
    expect(result.rationale.weather).toContain("a stout");
    expect(result.rationale.availability).toContain(`The ${beer.id}`);
  });

  it("never selects a persona without valid exact-drink venue evidence", () => {
    const result = selectSurpriseDrink(input({
      availability: [
        available(beer.id),
        { personaId: wine.id, alcoholType: "alcoholic", venues: [] },
        {
          personaId: cocktail.id,
          alcoholType: "alcoholic",
          venues: [{ venueId: "bar", venueName: "A Bar", priceGbp: 7, source: "", observedAt: "not-a-date" }],
        },
        available("not-in-the-sourced-persona-dataset"),
      ],
    }));

    expect(result.status).toBe("selected");
    expect(result.status === "selected" && result.persona.id).toBe(beer.id);
    expect(result.status === "selected" && result.venues).toHaveLength(1);
  });

  it("does not accept category-only map hints as exact drink availability", () => {
    const categoryHint = {
      personaId: beer.id,
      alcoholType: "alcoholic",
      drinkCategory: "beer",
      venueIds: ["pub-1"],
    } as unknown as SurpriseDrinkAvailability;

    expect(selectSurpriseDrink(input({ availability: [categoryHint] }))).toEqual({
      status: "empty",
      reason: "no-confirmed-availability",
    });
  });

  it("enforces zero-proof from availability evidence and excludes alcoholic or unknown choices", () => {
    const result = selectSurpriseDrink(input({
      zeroProof: true,
      availability: [
        available(beer.id, { alcoholType: "alcoholic" }),
        available(wine.id, { alcoholType: "unknown" }),
        available(zeroProof.id, { alcoholType: "low-no", venueName: "The Sober Arms" }),
      ],
    }));

    expect(result.status).toBe("selected");
    if (result.status !== "selected") return;
    expect(result.persona.id).toBe(zeroProof.id);
    expect(result.alcoholType).toBe("low-no");
  });

  it("merges duplicate persona availability deterministically", () => {
    const firstRow = available(beer.id, { venueId: "a", venueName: "A Arms", priceGbp: 6.2 });
    const secondRow = available(beer.id, { venueId: "b", venueName: "B Arms", priceGbp: 5.9 });
    const forward = selectSurpriseDrink(input({ availability: [firstRow, secondRow] }));
    const reverse = selectSurpriseDrink(input({ availability: [secondRow, firstRow] }));

    expect(forward).toEqual(reverse);
    expect(forward.status === "selected" && forward.venues.map((venue) => venue.venueId)).toEqual(["a", "b"]);
  });

  it("requires a real price and rejects stale or future availability", () => {
    const priced = available(beer.id);
    const invalidPrice = { ...priced, venues: [{ ...priced.venues[0], priceGbp: 0 }] };
    const recent = available(wine.id);
    const stale = { ...recent, venues: [{ ...recent.venues[0], observedAt: "2025-01-01T12:00:00.000Z" }] };
    const current = available(whisky.id);
    const future = { ...current, venues: [{ ...current.venues[0], observedAt: "2026-07-23T00:00:00.000Z" }] };

    expect(selectSurpriseDrink(input({ availability: [invalidPrice, stale, future] }))).toEqual({
      status: "empty",
      reason: "no-confirmed-availability",
    });
  });

  it("honours hard exclusions across persona, category and exact drink name", () => {
    const result = selectSurpriseDrink(input({
      availability: [
        available(beer.id),
        available(wine.id),
        available(whisky.id),
        available(cocktail.id),
      ],
      hardExclusions: {
        personaIds: [`  ${beer.id.toUpperCase()}  `],
        drinkCategories: ["wine", "whisky"],
        drinkNames: [cocktail.drink.toUpperCase()],
      },
    }));

    expect(result).toEqual({ status: "empty", reason: "all-hard-excluded" });
  });

  it("returns precise empty states for invalid keys, no evidence and zero-proof gaps", () => {
    expect(selectSurpriseDrink(input({ dayKey: "22/07/2026" }))).toEqual({
      status: "empty",
      reason: "invalid-selection-key",
    });
    expect(selectSurpriseDrink(input({ dayKey: "2026-02-31" }))).toEqual({
      status: "empty",
      reason: "invalid-selection-key",
    });
    expect(selectSurpriseDrink(input({ asOfIso: "2026-07-23T00:00:00.000Z" }))).toEqual({
      status: "empty",
      reason: "invalid-selection-key",
    });
    expect(selectSurpriseDrink(input({ availability: [] }))).toEqual({
      status: "empty",
      reason: "no-confirmed-availability",
    });
    expect(selectSurpriseDrink(input({ zeroProof: true }))).toEqual({
      status: "empty",
      reason: "no-zero-proof-availability",
    });
  });

  it("returns a preview-only result that requires confirmation before any memory write", () => {
    const result = selectSurpriseDrink(input());
    expect(result.status).toBe("selected");
    expect(result.status === "selected" && result.persistence).toBe(
      "requires-explicit-confirmation",
    );
  });
});
