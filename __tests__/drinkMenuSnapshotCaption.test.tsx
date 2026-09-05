// The venue Drinks caption, and WHICH question each lane's caption answers.
//
// Captain ruling 2026-09-05: the per-drink price lane (drink_price_updates) is
// a STATIC SNAPSHOT. Its only permitted source (Wetherspoons) publishes no
// per-drink web prices, so nothing may lawfully advance the file. A row from it
// must therefore be DATED and never carry a staleness warning: "Last seen" over
// a lane doing exactly what it was ruled to do is a warning about nothing, and
// the words come from lib/dataFreshness.ts so a drinker, a page caption and the
// freshness audit cannot drift into three vocabularies.
//
// The bundled pint dataset IS re-collected, so its rows keep the currency claim
// they always had, measured against the price-authority window. So does a Pint
// Drop: a drinker's live contribution carries its own seen date and is never a
// snapshot of anything, so the snapshot caption is keyed on the DECLARED
// snapshot lane and never on "not the dataset".

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import DrinkMenu from "@/components/drinks/DrinkMenu";
import {
  formatPintDatasetSnapshot,
  formatSnapshotFrom,
  PINT_DATASET_PRESENTATION_BUDGET_DAYS,
  SNAPSHOT_CAPTION_PREFIX,
} from "@/lib/dataFreshness";
import type { Drink } from "@/lib/drinks";

const OBSERVED_AT = "2026-08-21T15:44:29.901Z";

function overlayDrink(): Drink {
  return {
    id: "drink-overlay",
    category: "beer",
    name: "Lucky Saint 0.5%",
    priceGbp: 4.6,
    provenance: {
      source: "Wetherspoons",
      sourceUrl: "https://www.jdwetherspoon.com/",
      licence: "first-party",
      observedAt: OBSERVED_AT,
      lane: "drink-price-update",
    },
  };
}

function datasetDrink(observedAt: string): Drink {
  return {
    id: "drink-dataset",
    category: "beer",
    name: "House lager",
    priceGbp: 5.2,
    provenance: {
      source: "app-dataset",
      sourceUrl: "https://example.invalid/menu",
      licence: "CC BY-SA",
      observedAt,
      lane: "dataset",
    },
  };
}

function pintDropDrink(observedAt: string): Drink {
  // The shape lib/pintDropDrinks.ts mints: a community contribution, no lane.
  return {
    id: "pint-drop-abc",
    category: "beer",
    name: "Lager",
    priceGbp: 4.5,
    provenance: {
      source: "Pint Drop",
      licence: "community contribution",
      observedAt,
    },
  };
}

function render(drinks: Drink[]): string {
  return renderToStaticMarkup(
    createElement(DrinkMenu, { drinks, venueName: "The Test Arms" }),
  );
}

describe("venue Drinks captions", () => {
  it("dates a per-drink snapshot row instead of warning about it", () => {
    const html = render([overlayDrink()]);

    expect(html).toContain(SNAPSHOT_CAPTION_PREFIX);
    // The machine-readable stamp rides the caption, so the exact instant is
    // still on the page under the abbreviated day. (React emits the attribute
    // as it is authored; HTML attribute names are case-insensitive.)
    expect(html.toLowerCase()).toContain(`datetime="${OBSERVED_AT.toLowerCase()}"`);
    expect(html).toContain("21 Aug 2026");
    // No staleness warning, at any age: this lane has no budget to breach.
    expect(html).not.toContain("Last seen");
    expect(html).not.toContain(">Seen");
  });

  it("gives a live Pint Drop its own seen date, beside a snapshot row", () => {
    // Both lanes render in one menu, which is the point: two lanes, two claims.
    const seenAt = new Date(
      Date.now() - (PINT_DATASET_PRESENTATION_BUDGET_DAYS - 1) * 24 * 60 * 60 * 1000,
    ).toISOString();
    const html = render([overlayDrink(), pintDropDrink(seenAt)]);

    // The snapshot row keeps its date and its words.
    expect(html).toContain(`${SNAPSHOT_CAPTION_PREFIX} <time`);
    expect(html).toContain("21 Aug 2026");
    // The Pint Drop row is captioned "Seen", never "Snapshot from".
    expect(html).toContain("Seen <time");
    expect(html.toLowerCase()).toContain(`datetime="${seenAt.toLowerCase()}"`);
    expect(html.match(new RegExp(SNAPSHOT_CAPTION_PREFIX, "g"))).toHaveLength(1);
  });

  it("warns on a Pint Drop past the price-authority window, and never dates it as a snapshot", () => {
    const pastWindow = new Date(
      Date.now() - (PINT_DATASET_PRESENTATION_BUDGET_DAYS + 1) * 24 * 60 * 60 * 1000,
    ).toISOString();
    const html = render([pintDropDrink(pastWindow)]);

    expect(html).toContain("Last seen");
    expect(html).not.toContain(SNAPSHOT_CAPTION_PREFIX);
  });

  it("says the same words as the bundled bundle's own snapshot caption", () => {
    // One vocabulary. The page-level caption spells the date out in full and a
    // dense row caption abbreviates it, but neither may invent its own noun.
    expect(formatPintDatasetSnapshot().startsWith(SNAPSHOT_CAPTION_PREFIX)).toBe(true);
    expect(formatSnapshotFrom(new Date(OBSERVED_AT))).toBe(
      `${SNAPSHOT_CAPTION_PREFIX} 21 August 2026`,
    );
  });

  it("keeps the dataset lane's currency claim, both ways", () => {
    const insideWindow = new Date(
      Date.now() - (PINT_DATASET_PRESENTATION_BUDGET_DAYS - 1) * 24 * 60 * 60 * 1000,
    ).toISOString();
    const pastWindow = new Date(
      Date.now() - (PINT_DATASET_PRESENTATION_BUDGET_DAYS + 1) * 24 * 60 * 60 * 1000,
    ).toISOString();

    expect(render([datasetDrink(insideWindow)])).toContain("Seen");
    const stale = render([datasetDrink(pastWindow)]);
    expect(stale).toContain("Last seen");
    expect(stale).not.toContain(SNAPSHOT_CAPTION_PREFIX);
  });
});
