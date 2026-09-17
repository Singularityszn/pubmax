// A retired pub keeps its id, name, point and story, and every link to it still
// resolves; only its prices go (lib/priceRowEligibility.mjs). The Coronet's one
// dataset row is superseded, so its grouped venue carries no price rows, and
// the public pages that open it by id must answer without throwing and without
// the retired figure.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));

import BarTabPage from "@/app/bar-tab/[id]/page";
import LedgerPage from "@/app/ledger/[id]/page";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";

const rows = JSON.parse(
  readFileSync(join(process.cwd(), "public", "data", "pint_prices_app_dataset.json"), "utf8"),
) as Array<VenuePrice & { price_superseded?: unknown }>;

const retiredRow = rows.find((row) => row.app_price_id === "app_price_001274")!;
const retired = groupVenuePrices(rows).find((venue) => venue.id === "venue-60y3sa")!;

async function render(
  page: (props: { params: Promise<{ id: string }> }) => Promise<unknown>,
  id: string,
) {
  const element = await page({ params: Promise.resolve({ id }) });
  return renderToStaticMarkup(createElement(() => element as React.ReactElement));
}

describe("a pub whose only price row is superseded", () => {
  it("is The Coronet, with no live price", () => {
    expect(retiredRow.price_superseded).toBeTruthy();
    expect(retired.name).toBe("The Coronet");
    expect(retired.prices).toEqual([]);
    expect(retired.cheapestPrice).toBeNull();
  });

  it.each([
    { surface: "the Ledger", page: LedgerPage },
    { surface: "the Bar Tab", page: BarTabPage },
  ])("opens on $surface by name and shows no retired price", async ({ page }) => {
    const markup = await render(page, retired.id);
    expect(markup).toContain(retired.name);
    expect(markup).not.toContain("We could not load this pub");
    expect(markup).not.toContain(`£${Number(retiredRow.price_gbp).toFixed(2)}`);
  });
});
